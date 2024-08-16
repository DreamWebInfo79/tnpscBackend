require('dotenv').config();
const serverless = require('serverless-http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const passport = require('passport');
const mongoose = require('mongoose');
const axios = require('axios');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const app = express();



const allowedOrigins = ['http://localhost:3000', 'https://nizhaltnpsc.com', 'http://localhost:3001', 'https://www.nizhaltnpsc.com'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});

const UserSchema = new mongoose.Schema({
  googleId: String,
  displayName: String,
  email: String,
  uniqueId: String,
  plan: String,
  count: Number,
});

const secret = crypto.randomBytes(32).toString('hex');

app.use(session({ secret: secret, resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(bodyParser.json());

function generateUniqueId() {
  return uuidv4();
}

const dbSixth = mongoose.connection.useDb('sixthTamil');
dbSixth.on('error', console.error.bind(console, 'MongoDB connection error:'));
dbSixth.once('open', () => {
  console.log('Connected to MongoDB');
});

const dbUser = mongoose.connection.useDb('test');
dbUser.on('error', console.error.bind(console, 'MongoDB connection error:'));
dbUser.once('open', () => {
  console.log('Connected to MongoDB');
});

const QuestionSchema = new mongoose.Schema({
  question_number: Number,
  question_text: String,
  options: [String],
  answer: String,
  explanation: String,
  topic: String,
  type: String,
});

const Question = dbSixth.model('Question', QuestionSchema, 'termOne');
const User = dbUser.model('User', UserSchema);

// const dbNizhalUser = mongoose.connection.useDb('nizhaluser');
// dbNizhalUser.on('error', console.error.bind(console, 'MongoDB connection error:'));
// dbNizhalUser.once('open', () => {
//   console.log('Connected to MongoDB');
// });

// User model for nizhaluser database
// const User = dbNizhalUser.model('User', UserSchema);

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
},
async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });

    if (!user) {
      const uniqueId = generateUniqueId();
      user = new User({
        googleId: profile.id,
        displayName: profile.displayName,
        email: profile.emails[0].value,
        uniqueId: uniqueId,
        plan:"free",
        count:0,
      });
      await user.save();
    }

    const profileImageUrl = profile.photos[0].value;

    const userWithProfileImage = {
      ...user.toObject(),
      profileImageUrl
    };

    return done(null, userWithProfileImage);
  } catch (err) {
    return done(err, null);
  }
}
));

passport.serializeUser((userWithProfileImage, done) => {
  done(null, userWithProfileImage);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }));

  app.post('/auth/google/callback', async (req, res) => {
    const { token } = req.body;
  
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
  
      let user = await User.findOne({ googleId: payload.sub });
  
      if (!user) {
        const uniqueId = generateUniqueId();
        user = new User({
          googleId: payload.sub,
          displayName: payload.name,
          email: payload.email,
          uniqueId: uniqueId,
          plan:"free",
          count:0,
        });
        await user.save();
      }
  
      const userWithProfileImage = {
        ...user.toObject(),
        profileImageUrl: payload.picture,
      };
  
      req.login(userWithProfileImage, (err) => {
        if (err) {
          return res.status(500).send(err);
        }
        res.status(200).json(userWithProfileImage);
      });
    } catch (error) {
      console.error('Error processing login:', error);
      res.status(500).send({ message: 'Error processing login' });
    }
  });
  

app.get('/helloworld', (req, res) => {
  res.send('Hello World!');
});
app.post('/questions', async (req, res) => {
  const { userId, standard, subject, noOfQuestions } = req.body;

  try {
    const user = await User.findOne({ uniqueId: userId }); 
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const isNotPremiumOrBasic = user.plan !== 'premium' && user.plan !== 'basic';
    
    if (isNotPremiumOrBasic) {
      user.count = (user.count || 0) + 1;
      await user.save();
    }

    const database = mongoose.connection.useDb(standard);
    const Question = database.model('Question', QuestionSchema, subject);
    
    // Determine the number of questions to retrieve
    const questionsCount = parseInt(noOfQuestions) || 20;
    const questions = await Question.aggregate([{ $sample: { size: questionsCount } }]);

    res.json({ questions: questions, user: user });
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).send(error);
  }
});



// app.post('/api/aptitude', async (req, res) => {
//   const { userId, selectedTopics, selectedOptions, medium } = req.body;

//   if (!userId || !selectedTopics || !selectedOptions || !medium) {
//     return res.status(400).send({ message: 'Invalid request data' });
//   }

//   try {
//     const user = await User.findOne({ uniqueId: userId });
//     if (!user) {
//       return res.status(404).send({ message: 'User not found' });
//     }

//     if (user.plan !== 'premium' && user.plan !== 'basic') {
//       user.count = (user.count || 0) + 1;
//       await user.save();
//     }

//     const databaseName = medium === 'EM' ? 'commonAptitudeEM' : 'commonAptitudeTM';
//     const database = mongoose.connection.useDb(databaseName);
//     const Question = database.model('Question', QuestionSchema, 'allAptitude');
    

//     let questions = [];
//     const totalQuestions = parseInt(selectedOptions, 10);

//     if (medium === 'EM') {
//       const questionsPerTopic = Math.floor(totalQuestions / selectedTopics.length);
//       const remainderQuestions = totalQuestions % selectedTopics.length;

//       for (let i = 0; i < selectedTopics.length; i++) {
//         const topic = selectedTopics[i];
//         const size = questionsPerTopic + (i < remainderQuestions ? 1 : 0); // Distribute remainder questions

//         const topicQuestions = await Question.aggregate([
//           { $match: { topic: topic } },
//           { $sample: { size: size } }
//         ]);

//         questions = questions.concat(topicQuestions);
//       }
//     } else {
//       // For Tamil medium, select random questions without topic filter
//       questions = await Question.aggregate([
//         { $sample: { size: totalQuestions } }
//       ]);
//     }

//     res.status(200).send({ questions });
//   } catch (error) {
//     console.error('Error fetching questions:', error);
//     res.status(500).send({ message: 'Error fetching questions' });
//   }
// });








app.post('/api/aptitude', async (req, res) => {
  const { userId, selectedTopics, selectedOptions, medium } = req.body;

  if (!userId || !selectedTopics || !selectedOptions || !medium) {
    return res.status(400).send({ message: 'Invalid request data' });
  }

  try {
    const user = await User.findOne({ uniqueId: userId });
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    if (user.plan !== 'premium' && user.plan !== 'basic') {
      user.count = (user.count || 0) + 1;
      await user.save();
    }

    const databaseName = medium === 'EM' ? 'commonApiEM' : 'commonApiTM';
    // console.log(databaseName);
    const database = mongoose.connection.useDb(databaseName);
    const Question = database.model('Question', QuestionSchema, 'allAptitude');

    let questions = [];
    const totalQuestions = parseInt(selectedOptions, 10);
    const questionsPerTopic = Math.floor(totalQuestions / selectedTopics.length);
    const remainderQuestions = totalQuestions % selectedTopics.length;

    for (let i = 0; i < selectedTopics.length; i++) {
      const topic = selectedTopics[i];
      const size = questionsPerTopic + (i < remainderQuestions ? 1 : 0); // Distribute remainder questions

      const topicQuestions = await Question.aggregate([
        { $match: { topic: topic } },
        { $sample: { size: size } }
      ]);

      questions = questions.concat(topicQuestions);
    }

    res.status(200).send({ questions:questions,user:user });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).send({ message: 'Error fetching questions' });
  }
});

// app.get('/', (req, res) => {
//   if (req.user) {
//     const uniqueId = req.user.uniqueId;
//     res.send(`Hello ${req.user.displayName}. Your unique ID is ${uniqueId}.`);
//   } else {
//     res.send('Hello Guest. Please <a href="/auth/google">login with Google</a>.');
//   }
// });

app.get('/api/user', (req, res) => {
  if (req.user) {
    const { uniqueId, displayName, imageUrl } = req.user;
    res.json({ uniqueId, displayName, imageUrl });
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

app.post('/api/weekly-test-em', async (req, res) => {
  const newDbName = 'weeklyTest';
  // const newCollectionName = 'allQuestionsEM';
  const userId = req.body.userId; 
  const selectedLanguage = req.body.selectedLanguage;
  const newCollectionName = selectedLanguage === 'EM' ? 'allQuestionsEM' : 'allQuestionsTM';


  try {
    const user = await User.findOne({ uniqueId: userId }); 
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const isPremiumOrBasic = user.plan === 'premium' || user.plan === 'basic';
    
    if (!isPremiumOrBasic) {
      return res.status(403).send({ message: 'Access denied. Premium or basic plan required.' });
    }

    const aggregatedDb = mongoose.connection.useDb(newDbName);
    const AggregatedQuestion = aggregatedDb.model('AggregatedQuestion', QuestionSchema, newCollectionName);

    const tamilQuestions = await AggregatedQuestion.aggregate([{ $match: { type: 'tamil' } }, { $sample: { size: 100 } }]);
    const gsQuestions = await AggregatedQuestion.aggregate([{ $match: { type: 'gs' } }, { $sample: { size: 75 } }]);
    const aptitudeQuestions = await AggregatedQuestion.aggregate([{ $match: { type: 'aptitude' } }, { $sample: { size: 25 } }]);

    const selectedQuestions = [
      ...tamilQuestions,
      ...gsQuestions,
      ...aptitudeQuestions,
    ];

    res.status(200).send({ selectedQuestions });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).send({ message: 'Error fetching questions' });
  }
});

// To get all the data from the collection 

app.post('/get-all-questions', async (req, res) => {
  const { userId, standard, subject } = req.body;

  try {
    const user = await User.findOne({ uniqueId: userId }); 
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const isNotPremiumOrBasic = user.plan !== 'premium' && user.plan !== 'basic';
    
    if (isNotPremiumOrBasic) {
      user.count = (user.count || 0) + 1;
      await user.save();
    }

    const database = mongoose.connection.useDb(standard);
    const Question = database.model('Question', QuestionSchema, subject);
    const questions = await Question.find({});

    res.json(questions);
    console.log(questions);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).send(error);
  }
});



// API USED TO MERGE COLLECTIONS
// app.post('/aggregate-aptitude-questions', async (req, res) => {
//   // const dbNames = ['db1', 'db2', 'db3', 'db4', 'db5', 'db6', 'db7', 'db8', 'db9', 'db10'];
//   // const collectionNames = ['collection1', 'collection2', 'collection3', 'collection4', 'collection5'];
//   const dbNames = ['aptitudeTM'];
//   const collectionNames = ['1-4thUnit','9-12Unit','5-8Unit','13-16Unit'];
//   const newDbName = 'commonAptitudeTM';
//   const newCollectionName = 'allAptitude';

//   try {
//     let allQuestions = [];

//     for (const dbName of dbNames) {
//       const db = mongoose.connection.useDb(dbName);

//       for (const collectionName of collectionNames) {
//         const Question = db.model('Question', QuestionSchema, collectionName);
//         const questions = await Question.find({}).lean();
//         allQuestions = allQuestions.concat(questions);
//       }
//     }

//     const aggregatedDb = mongoose.connection.useDb(newDbName);
//     const AggregatedQuestion = aggregatedDb.model('AggregatedQuestion', QuestionSchema, newCollectionName);

//     await AggregatedQuestion.insertMany(allQuestions.map(q => ({ ...q, type: 'aptitude' })));

//     res.status(201).send('gs questions aggregated successfully');
//   } catch (error) {
//     console.error('Error aggregating aptitude questions:', error);
//     res.status(500).send({ message: 'Error aggregating aptitude questions' });
//   }
// });

// API USED TO CREATE NEW DB AND COLLECTION FROM OTHER DB AND COLLECTION
// app.post('/copy-aptitude-questions', async (req, res) => {
//   const { sourceDbName, sourceCollectionName, targetDbName, targetCollectionName } = req.body;

//   try {
//     const sourceDb = mongoose.connection.useDb("weeklyTest");
//     const SourceQuestion = sourceDb.model('Question', QuestionSchema, "allQuestionsEM");

//     const aptitudeQuestions = await SourceQuestion.find({ type : 'aptitude' }).lean();

//     if (aptitudeQuestions.length === 0) {
//       return res.status(404).send({ message: 'No aptitude questions found' });
//     }

//     const targetDb = mongoose.connection.useDb("commonAptitudeEM");
//     const TargetQuestion = targetDb.model('Question', QuestionSchema, "allAptitude");

//     await TargetQuestion.insertMany(aptitudeQuestions);

//     res.status(201).send({ message: 'Aptitude questions copied successfully', count: aptitudeQuestions.length });
//   } catch (error) {
//     console.error('Error copying aptitude questions:', error);
//     res.status(500).send({ message: 'Error copying aptitude questions' });
//   }
// });



// app.post('/api/duplicate-questions', async (req, res) => {
//   const { databaseName, collectionName } = req.body;

//   try {
//     const database = mongoose.connection.useDb(databaseName);
//     const Question = database.model('Question', QuestionSchema, collectionName);

//     const duplicateQuestions = await Question.aggregate([
//       {
//         $group: {
//           _id: "$question_text",
//           count: { $sum: 1 },
//           docs: { $push: "$$ROOT" }
//         }
//       },
//       {
//         $match: {
//           count: { $gt: 1 }
//         }
//       }
//     ]);

//     const duplicateIdsToKeep = [];
//     const remainingIds = [];

//     duplicateQuestions.forEach(group => {
//       duplicateIdsToKeep.push(group.docs[0]._id);
      
//       for (let i = 1; i < group.docs.length; i++) {
//         remainingIds.push(group.docs[i]._id);
//       }
//     });

//     res.status(200).json({duplicateQuestions,remainingIds});
//   } catch (error) {
//     console.error('Error fetching duplicate questions:', error);
//     res.status(500).send({ message: 'Error fetching duplicate questions' });
//   }
// });

// app.post('/api/delete-questions', async (req, res) => {
//   const { databaseName, collectionName, ids } = req.body;

//   if (!Array.isArray(ids) || ids.length === 0) {
//     return res.status(400).send({ message: 'Invalid or missing IDs array' });
//   }

//   try {
//     const database = mongoose.connection.useDb(databaseName);
//     const Question = database.model('Question', QuestionSchema, collectionName);

//     const result = await Question.deleteMany({ _id: { $in: ids } });

//     if (result.deletedCount === 0) {
//       return res.status(404).send({ message: 'No questions found to delete' });
//     }
//     console.log(res)

//     res.status(200).send({ message: 'Questions deleted successfully', deletedCount: result.deletedCount });
//   } catch (error) {
//     console.error('Error deleting questions:', error);
//     res.status(500).send({ message: 'Error deleting questions' });
//   }
// });



// payment

const SALT_KEY = process.env.PHONEPE_API_KEY;
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_INDEX = process.env.PHONEPE_KEY_INDEX;
const MAX_RETRIES = process.env.PHONEPE_MAX_RETRIES;
const PROD_URL = process.env.PHONEPE_URL;

app.post('/api/pay', async (req, res) => {
  try {
      let merchantTransactionId = req.body.transactionId;
      let userId = req.body.userId;
      const data = {
          merchantId: MERCHANT_ID,
          merchantTransactionId: merchantTransactionId,
          merchantUserId: 'MUID' + `${req.body.name}12345`,
          amount: req.body.amount * 100,
          redirectUrl: `https://2mn4dxxw3hj2yrhqzbsxdyirva0uksoy.lambda-url.ap-south-1.on.aws/status/${merchantTransactionId}/${userId}`,
          redirectMode: 'POST',
          mobileNumber: req.body.number,
          paymentInstrument: {
              type: 'PAY_PAGE'
          }
      };
      const payload = JSON.stringify(data);
      const payloadMain = Buffer.from(payload).toString('base64');
      const keyIndex = 1;
      const string = payloadMain + '/pg/v1/pay' + SALT_KEY;
      const sha256 = crypto.createHash('sha256').update(string).digest('hex');
      const checksum = sha256 + '###' + keyIndex;

      const options = {
          method: 'POST',
          url: PROD_URL,
          headers: {
              accept: 'application/json',
              'Content-Type': 'application/json',
              'X-VERIFY': checksum
          },
          data: { request: payloadMain }
      };

      await axios(options).then(function (response) {
        const allowedOrigins = ['https://nizhaltnpsc.com', 'https://www.nizhaltnpsc.com'];
        const origin = req.headers.origin;
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        res.setHeader('Access-Control-Allow-Credentials', true);
        return res.json(response.data);
    
      }).catch(function (err) {
          console.log(err);
          res.status(500).send({ message: `Error processing payment ${err}` });
      });
  } catch (e) {
      console.log(e);
  }
});


app.post('/status/:transactionId/:userId', async (req, res) => {
  const merchantTransactionId = req.params.transactionId; 
  const userId = req.params.userId;
  const merchantId = MERCHANT_ID;
  const keyIndex = 1;
  const string = `/pg/v1/status/${merchantId}/${merchantTransactionId}` + SALT_KEY;
  const sha256 = crypto.createHash('sha256').update(string).digest('hex');
  const checksum = sha256 + "###" + keyIndex;

  const options = {
      method: 'GET',
      url: `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${merchantTransactionId}`,
      headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': `${merchantId}`
      }
  };

  let attempts = 0;
  const maxAttempts = 30; 

  const pollPaymentStatus = async () => {
      try {
          const response = await axios.request(options);
          if (response.data.code === "PAYMENT_SUCCESS") {
              const paymentData = response.data;
              const amount = paymentData.data.amount;
              let plan;
              if (amount === 9900) {
                  plan = 'basic';
              } else if (amount === 19900) {
                  plan = 'premium';
              }else{
                plan = 'free';
              }
              if (plan) {
                  await User.findOneAndUpdate({ uniqueId: userId }, { $set: { plan } });
              }
              clearInterval(interval);
              const successUrl = 'https://nizhaltnpsc.com/payment/success';
              return res.redirect(successUrl);
          } else if (attempts >= maxAttempts) {
              clearInterval(interval); 
              const failureUrl = 'https://nizhaltnpsc.com/payment/failure';
              return res.redirect(failureUrl);
          }
      } catch (error) {
          console.error('Error verifying payment status:', error);
          clearInterval(interval); 
          const failureUrl = 'https://nizhaltnpsc.com/payment/failure';
          return res.redirect(failureUrl);
      }
  };

  const interval = setInterval(async () => {
      attempts++;
      await pollPaymentStatus();
  }, 3000);

  await pollPaymentStatus();
});

// app.post('/statuss/:transactionId/:userId', async (req, res) => {
//   const merchantTransactionId = req.params.transactionId; 
//   const userId = req.params.userId;
//   const merchantId = MERCHANT_ID;
//   const keyIndex = 1;
//   const string = `/pg/v1/status/${merchantId}/${merchantTransactionId}` + SALT_KEY;
//   const sha256 = crypto.createHash('sha256').update(string).digest('hex');
//   const checksum = sha256 + "###" + keyIndex;

//   const options = {
//       method: 'GET',
//       url: `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${merchantTransactionId}`,
//       headers: {
//           accept: 'application/json',
//           'Content-Type': 'application/json',
//           'X-VERIFY': checksum,
//           'X-MERCHANT-ID': `${merchantId}`
//       }
//   };

//   try {
//       const response = await axios.request(options);
//       console.log(response);
//       if (response.data.code === "PAYMENT_SUCCESS") {
//           const paymentData = response.data;
//           const amount = paymentData.data.amount;
//           let plan;
//           if (amount === 9900) {
//               plan = 'basic';
//           } else if (amount === 19900) {
//               plan = 'premium';
//           } else {
//               plan = 'free';
//           }
//           if (plan) {
//               await User.findOneAndUpdate({ uniqueId: userId }, { $set: { plan } });
//           }
//           const successUrl = 'https://nizhaltnpsc.com/payment/success';
//           return res.redirect(successUrl);
//       } else {
//           const failureUrl = 'https://nizhaltnpsc.com/payment/failure';
//           return res.redirect(failureUrl);
//       }
//   } catch (error) {
//       console.error('Error verifying payment status:', error);
//       const failureUrl = 'https://nizhaltnpsc.com/payment/failure';
//       return res.redirect(failureUrl);
//   }
// });


app.get('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findOne({ uniqueId: userId }); // Use uniqueId to find the user

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});


module.exports.handler = serverless(app);



