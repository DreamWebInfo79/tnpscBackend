require('dotenv').config();
const serverless = require('serverless-http');
const express = require('express');
const session = require('express-session');
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

const allowedOrigins = ['http://localhost:3000', 'https://nizhaltnpsc.com', 'http://localhost:3001'];

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
  uniqueId: String
});

const secret = crypto.randomBytes(32).toString('hex');

app.use(session({ secret: secret, resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({extended: true}));

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
        uniqueId: uniqueId
      });
      await user.save();
    }

    const profileImageUrl = profile.photos[0].value;

    const userWithProfileImage = {
      ...user.toObject(),
      profileImageUrl
    };

    console.log(userWithProfileImage);
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
          uniqueId: uniqueId
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
  const { standard, subject } = req.body;

  try {
    const database = mongoose.connection.useDb(standard);
    const Question = database.model('Question', QuestionSchema, subject);

    const questions = await Question.aggregate([{ $sample: { size: 20 } }]);

    res.json(questions);
    console.log(questions);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/api/aptitude', async (req, res) => {
  const { selectedTopics, selectedOptions } = req.body;

  try {
    let questions = [];
    for (const topic of selectedTopics) {
      const database = mongoose.connection.useDb("commonAptitudeEM");
      const Question = database.model('Question', QuestionSchema, "allAptitude");

      // Fetch a random set of `selectedOptions` questions for each topic
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


app.get('/', (req, res) => {
  if (req.user) {
    const uniqueId = req.user.uniqueId;
    res.send(`Hello ${req.user.displayName}. Your unique ID is ${uniqueId}.`);
  } else {
    res.send('Hello Guest. Please <a href="/auth/google">login with Google</a>.');
  }
});

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

  try {
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

app.get('/api/duplicate-questions', async (req, res) => {
  const { databaseName, collectionName } = req.query;

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

    res.status(200).json(duplicateQuestions);
  } catch (error) {
    console.error('Error fetching duplicate questions:', error);
    res.status(500).send({ message: 'Error fetching duplicate questions' });
  }
});

app.delete('/api/delete-questions', async (req, res) => {
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

    res.status(200).send({ message: 'Questions deleted successfully', deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Error deleting questions:', error);
    res.status(500).send({ message: 'Error deleting questions' });
  }
});



// payment


const SALT_KEY = '99dca50f-ca85-495c-b9d4-93175e09c059';
const MERCHANT_ID = 'M22EBJVFV4DM6';
const SALT_INDEX = '1';
const BASE_URL = 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay';
const MAX_RETRIES = 5;

app.post('/api/pay',async(req,res)=>{
  try{
    let merchantTransactionId=req.body.transactionId;

    const data={
      merchantId:MERCHANT_ID,
      merchantTransactionId:merchantTransactionId,
      merchantUserId:req.body.name + "12345",
      amount:1000,
      redirectUrl:`http://localhost:3001/status?id=${merchantTransactionId}`,
      redirectMode:'REDIRECT',
      callbackUrl:`http://localhost:3001/status?id=${merchantTransactionId}`,
      mobileNumber: req.body.number,
      paymentInstrument:{
        type: 'PAY_PAGE'
      }
    }
    console.log(data);
    const payload=JSON.stringify(data);
    console.log("payload",payload)
    const payloadMain=Buffer.from(payload).toString('base64');
    console.log("payloadMain",payloadMain);
    const keyIndex= 1
    const string = payloadMain + '/pg/v1/pay'+ SALT_KEY;
    console.log("keyIndex",keyIndex);
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    console.log("sha256",sha256);
    const checksum = sha256 + '###' + keyIndex;
    console.log("checksum",checksum);
    
    const prod_Url = 'https://api.phonepe.com/apis/hermes/pg/v1/pay'
  
  
    const options = {
      method: 'POST',
      url:prod_Url,
      headers: { 
        'Content-Type':'application/json',
        'X-VERIFY':checksum
      },
      data:{
         request:payloadMain
      }
    }

    await axios(options).then(function(response) {
      console.log(response.data);
      return res.json(response.data);
    }).catch(function(err) {
      console.log(err);
    });
  
  }catch(e){
console.log(e);
  }
})

app.post('/status/:id', function(req, res) {
  console.log("success");
})


// function generateXVerify(payloadBase64) {
//   const data = payloadBase64 + '/pg/v1/pay' + SALT_KEY;
//   const hash = crypto.createHash('sha256').update(data).digest('hex');
//   return `${hash}###${SALT_INDEX}`;
// }

// async function makeRequestWithRetry(url, data, headers, retries = 0) {
//   try {
//     const response = await axios.post(url, data, { headers });
//     return response.data;
//   } catch (error) {
//     if (error.response && error.response.status === 429 && retries < MAX_RETRIES) {
//       const retryAfter = parseInt(error.response.headers['retry-after'], 10) || 1;
//       await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 * (2 ** retries)));
//       return makeRequestWithRetry(url, data, headers, retries + 1);
//     } else {
//       throw error;
//     }
//   }
// }

// app.post('/api/pay', async (req, res) => {
//   const { merchantTransactionId, merchantUserId, amount, redirectUrl, callbackUrl, mobileNumber } = req.body;

//   const payload = {
//     merchantId: MERCHANT_ID,
//     merchantTransactionId,
//     merchantUserId,
//     amount,
//     redirectUrl,
//     redirectMode: 'REDIRECT',
//     callbackUrl,
//     mobileNumber,
//     paymentInstrument: {
//       type: 'PAY_PAGE'
//     }
//   };

//   const newPayload={
//     "merchantId": "PGTESTPAYUAT",
//     "merchantTransactionId": "MT7850590068188104",
//     "merchantUserId": "MUID123",
//     "amount": 10000,
//     "redirectUrl": "http://localhost:3000/",
//     "redirectMode": "REDIRECT",
//     "callbackUrl": "http://localhost:3000/callback-url",
//     "mobileNumber": "9999999999",
//     "paymentInstrument": {
//       "type": "PAY_PAGE"
//     }
//   }

//   const payloadBase64 = Buffer.from(JSON.stringify(newPayload)).toString('base64');
//   const xVerify = generateXVerify(payloadBase64);

//   const headers = {
//     'Content-Type': 'application/json',
//     'X-VERIFY': xVerify
//   };

//   const data = {
//     request: payloadBase64
//   };

//   try {
//     const response = await makeRequestWithRetry(BASE_URL, data, headers);
//     res.json(response);
//     console.log(response)
//   } catch (error) {
//     console.log(response)
//     // console.error('Error initiating payment:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});





module.exports.handler = serverless(app);
