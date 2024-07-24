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
  const { user_id, standard, subject } = req.body;

  try {
    const user = await User.findOne({ uniqueId: user_id }); 
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
    const questions = await Question.aggregate([{ $sample: { size: 20 } }]);

    res.json(questions);
    console.log(questions);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).send(error);
  }
});


app.post('/api/aptitude', async (req, res) => {
  const { user_id, selectedTopics, selectedOptions, selectedLanguage } = req.body;
  // const selectedLanguage = need to send from frontend databasename there is only two databse
  // commonAptitudeEM and commonAptitudeTM
  try {
    const user = await User.findOne({ uniqueId: user_id }); 
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    console.log(user);

    const isNotPremiumOrBasic = user.plan !== 'premium' && user.plan !== 'basic';

    if (isNotPremiumOrBasic) {
      user.count = (user.count || 0) + 1;
      await user.save();
    }

    let questions = [];
    for (const topic of selectedTopics) {
      const database = mongoose.connection.useDb(selectedLanguage);
      const Question = database.model('Question', QuestionSchema, "allAptitude");

      const topicQuestions = await Question.aggregate([
        { $match: { topic: topic } },
        { $sample: { size: selectedOptions } }
      ]);

      questions = questions.concat(topicQuestions);
    }

    res.status(200).send({ questions });
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

app.get('/api/weekly-test-em', async (req, res) => {
  const newDbName = 'weeklyTest';
  const newCollectionName = 'allQuestionsEM';
  const user_id = req.body.user_id; 

  try {
    const user = await User.findOne({ uniqueId: user_id }); 
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



app.post('/api/duplicate-questions', async (req, res) => {
  const { databaseName, collectionName } = req.body;

  try {
    const database = mongoose.connection.useDb(databaseName);
    const Question = database.model('Question', QuestionSchema, collectionName);

    const duplicateQuestions = await Question.aggregate([
      {
        $group: {
          _id: "$question_text",
          count: { $sum: 1 },
          docs: { $push: "$$ROOT" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    const duplicateIdsToKeep = [];
    const remainingIds = [];

    duplicateQuestions.forEach(group => {
      duplicateIdsToKeep.push(group.docs[0]._id);
      
      for (let i = 1; i < group.docs.length; i++) {
        remainingIds.push(group.docs[i]._id);
      }
    });

    res.status(200).json({duplicateQuestions,remainingIds});
  } catch (error) {
    console.error('Error fetching duplicate questions:', error);
    res.status(500).send({ message: 'Error fetching duplicate questions' });
  }
});

app.post('/api/delete-questions', async (req, res) => {
  const { databaseName, collectionName, ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).send({ message: 'Invalid or missing IDs array' });
  }

  try {
    const database = mongoose.connection.useDb(databaseName);
    const Question = database.model('Question', QuestionSchema, collectionName);

    const result = await Question.deleteMany({ _id: { $in: ids } });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'No questions found to delete' });
    }
    console.log(res)

    res.status(200).send({ message: 'Questions deleted successfully', deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Error deleting questions:', error);
    res.status(500).send({ message: 'Error deleting questions' });
  }
});



// payment

const SALT_KEY = process.env.SALT_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;
const SALT_INDEX = process.env.SALT_INDEX;
const MAX_RETRIES = process.env.MAX_RETRIES;
const PROD_URL = process.env.PROD_URL;

app.post('/api/pay',async(req,res)=>{
  try{
    let merchantTransactionId=req.body.transactionId;
    let user_id=req.body.userId;

    const data={
      merchantId:MERCHANT_ID,
      merchantTransactionId:merchantTransactionId,
      merchantUserId:`${req.body.name}12345`,
      amount:req.body.amount * 100,
      redirectUrl:`https://2mn4dxxw3hj2yrhqzbsxdyirva0uksoy.lambda-url.ap-south-1.on.aws/status?id=${merchantTransactionId}user_id=${user_id}`,
      redirectMode:'POST',
      mobileNumber: req.body.number,
      paymentInstrument:{
        type: 'PAY_PAGE'
      }
    }
    const payload=JSON.stringify(data);
    // console.log(payload);
    const payloadMain=Buffer.from(payload).toString('base64');
    const keyIndex= 1
    const string = payloadMain + '/pg/v1/pay'+ SALT_KEY;
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    const checksum = sha256 + '###' + keyIndex;
    // console.log("PROD_URL",PROD_URL);  
    // console.log("SALT_KEY",SALT_KEY);
    
  
  
    const options = {
      method: 'POST',
      url:PROD_URL,
      headers: { 
        'Content-Type':'application/json',
        'X-VERIFY':checksum
      },
      data:{
         request:payloadMain
      }
    }


    await axios(options).then(function (response) {
      res.setHeader('Access-Control-Allow-Origin', 'https://nizhaltnpsc.com', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
      res.setHeader('Access-Control-Allow-Credentials', true);
      return res.json(response.data);
    }).catch(function (err) {
      console.log(err);

    //   await axios(options).then(function (response) {
    //     console.log(response.data);
    //     return res.json(response.data);
    // }).catch(function (err) {
    //   console.log(err);
    

      res.status(500).send({ message: `Error processing payment ${err}`});
    });

  
  }catch(e){
    console.log(e);
  }
})

app.post('/status', async (req, res) => {
  const merchantTransactionId = req.query.id;
  const user_id=req.query.user_id;
  const merchantId = MERCHANT_ID;

  const keyIndex = 1;
  const string = `/pg/v1/status/${merchantId}/${merchantTransactionId}` + SALT_KEY;
  const sha256 = crypto.createHash('sha256').update(string).digest('hex');
  const checksum = sha256 + "###" + keyIndex;

  const options = {
    method: 'GET',
    url: `https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status/${merchantId}/${merchantTransactionId}`,
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-VERIFY': checksum,
      'X-MERCHANT-ID': `${merchantId}`
    }
  };

  try {
    const response = await axios.request(options);

    if (response.data.success === true) {
      const paymentData = response.data; 

      // const user_id = paymentData.user_id;
      const amount = paymentData.amount;

      let plan;
      if (amount === 99) {
        plan = 'basic';
      } else if (amount === 199) {
        plan = 'premium';
      }else if (amount === 1){
        plan="standard"
      }

      if (plan) {
        await User.findOneAndUpdate({ uniqueId: user_id }, { $set: { plan } });
      }
      const successUrl = `https://nizhaltnpsc.com/payment/success`;
      return res.redirect(successUrl);
    } else {
      const failureUrl = `https://nizhaltnpsc.com/payment/failure`;
      return res.redirect(failureUrl);
    }
  } catch (error) {
    console.error('Error verifying payment status:', error);
    const failureUrl = `https://nizhaltnpsc.com/payment/failure`;
    return res.redirect(failureUrl);
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});


module.exports.handler = serverless(app);
