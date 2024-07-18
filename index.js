require('dotenv').config();
const serverless = require('serverless-http');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const mongoose = require('mongoose');
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

const allowedOrigins = ['http://localhost:3001'];

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

app.post('/add-question', async (req, res) => {
  try {
    const newQuestion = new Question(req.body);
    await newQuestion.save();
    res.status(201).send('Question added successfully');
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/aggregate-aptitude-questions', async (req, res) => {
  const dbNames = ['commonAptitudeEM'];
  const collectionNames = ['allAptitude'];
  const newDbName = 'weeklyTest';
  const newCollectionName = 'allQuestionsEM';

  try {
    let allQuestions = [];

    for (const dbName of dbNames) {
      const db = mongoose.connection.useDb(dbName);

      for (const collectionName of collectionNames) {
        const Question = db.model('Question', QuestionSchema, collectionName);
        const questions = await Question.find({}).lean();
        allQuestions = allQuestions.concat(questions);
      }
    }

    const aggregatedDb = mongoose.connection.useDb(newDbName);
    const AggregatedQuestion = aggregatedDb.model('AggregatedQuestion', QuestionSchema, newCollectionName);

    await AggregatedQuestion.insertMany(allQuestions.map(q => ({ ...q, type: 'aptitude' })));

    res.status(201).send('Aptitude questions aggregated successfully');
  } catch (error) {
    console.error('Error aggregating aptitude questions:', error);
    res.status(500).send({ message: 'Error aggregating aptitude questions' });
  }
});

// app.get('/', (req, res) => {
//   if (req.user) {
//     const { uniqueId, displayName, imageUrl } = req.user;
//     res.send(`
//       <div>
//         <h1>Hello ${displayName}</h1>
//         <img src="${imageUrl}" alt="${displayName}" />
//         <p>Your unique ID is ${uniqueId}</p>
//       </div>
//     `);
//   } else {
//     res.send('Hello Guest. Please <a href="/auth/google">login with Google</a>.');
//   }
// });

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

app.post('/add-gs-questions', async (req, res) => {
  const dbNames = ['generalStudiesEM'];
  const newDbName = 'weeklyTest';
  const newCollectionName = 'allQuestionsEM';

  try {
    let allQuestions = [];

    for (const dbName of dbNames) {
      const db = mongoose.connection.useDb(dbName);

      // Fetch all collections in current database
      const collections = await db.db.listCollections().toArray();

      for (const collection of collections) {
        const collectionName = collection.name;
        const Question = db.model('Question', QuestionSchema, collectionName);
        const questions = await Question.find({}).lean();
        allQuestions = allQuestions.concat(questions.map(q => ({ ...q, type: 'gs' })));
      }
    }

    const aggregatedDb = mongoose.connection.useDb(newDbName);
    const AggregatedQuestion = aggregatedDb.model('AggregatedQuestion', QuestionSchema, newCollectionName);

    await AggregatedQuestion.insertMany(allQuestions);

    res.status(201).send('GS questions added successfully');
  } catch (error) {
    console.error('Error adding GS questions:', error);
    res.status(500).send({ message: 'Error adding GS questions' });
  }
});

app.post('/aggregate-tamil-questions', async (req, res) => {
  const dbNames = ['sixthTamil', 'seventhTamil', 'eightTamil', 'ninthTamil', 'Tenth'];
  const newDbName = 'weeklyTest';
  const newCollectionName = 'allQuestionsEM';

  try {
    let allQuestions = [];

    for (const dbName of dbNames) {
      const db = mongoose.connection.useDb(dbName);

      // Fetch all collections in current database
      const collections = await db.db.listCollections().toArray();

      for (const collection of collections) {
        const collectionName = collection.name;
        const Question = db.model('Question', QuestionSchema, collectionName);
        const questions = await Question.find({}).lean();
        allQuestions = allQuestions.concat(questions.map(q => ({ ...q, type: 'tamil' })));
      }
    }

    const aggregatedDb = mongoose.connection.useDb(newDbName);
    const AggregatedQuestion = aggregatedDb.model('AggregatedQuestion', QuestionSchema, newCollectionName);

    await AggregatedQuestion.insertMany(allQuestions);

    res.status(201).send('Tamil questions aggregated successfully');
  } catch (error) {
    console.error('Error aggregating Tamil questions:', error);
    res.status(500).send({ message: 'Error aggregating Tamil questions' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

module.exports.handler = serverless(app);
