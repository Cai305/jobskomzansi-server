import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { JobAggregatorService } from './services/job-aggregator.service';
import authRoutes from './routes/auth.routes';
import { JobReportModel } from './models/job-report.model';

import { setupSwagger } from './swagger';

const app = express();
const jobService = new JobAggregatorService();

app.use(cors());
app.use(express.json());

setupSwagger(app);

// DB Connection Logic
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/jobskomzansi';

let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  
  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    isConnected = true;
    console.log('Connected to MongoDB');
    
    // One-time initialization logic
    const { UserModel } = await import('./models/user.model');
    const bcrypt = await import('bcrypt');
    const adminExists = await UserModel.findOne({ role: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await new UserModel({
        email: 'admin@jobs.com',
        password: hashedPassword,
        name: 'System Admin',
        role: 'admin',
        isVerified: true,
        isVetted: true
      }).save();
      console.log('Default admin created');
    }

    // Migration: Update existing employers with vettingStatus
    const employersWithoutStatus = await UserModel.find({ 
      role: 'employer', 
      vettingStatus: { $exists: false } 
    });
    
    if (employersWithoutStatus.length > 0) {
      console.log(`Migrating ${employersWithoutStatus.length} employers to include vettingStatus...`);
      for (const emp of employersWithoutStatus) {
        emp.vettingStatus = emp.isVetted ? 'approved' : 'pending';
        await emp.save();
      }
      console.log('Migration complete');
    }
    
    // checkInitialFetch
    if (mongoose.connection.db) {
      const count = await mongoose.connection.db.collection('jobs').countDocuments();
      if (count === 0) {
        console.log('DB is empty, performing initial fetch...');
        jobService.refreshCache(); // Fire and forget
      }
    }
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err;
  }
};

// Initialize DB connection (this is still useful for warm starts)
connectDB().catch(err => console.error('Initial DB connection failed:', err));

// Middleware to ensure DB connection is ready (Serverless Friendly)
app.use(async (req, res, next) => {
  try {
    if (!isConnected || mongoose.connection.readyState !== 1) {
      console.log('Database not connected, attempting to connect...');
      await connectDB();
    }
    next();
  } catch (error) {
    console.error('Middleware database connection error:', error);
    res.status(503).json({ error: 'Database connection failed. Please try again in a few seconds.' });
  }
});

// Root route for health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'JobsKomzansi API is running' });
});

// Routes
app.use('/auth', authRoutes);

/**
 * @swagger
 * /jobs:
 *   get:
 *     summary: Retrieve a list of jobs
 */
app.get('/jobs', async (req, res) => {
  try {
    const { keyword, location, userId } = req.query;
    const jobs = await jobService.getJobsFromDB((keyword as string) || '', (location as string) || '', userId as string);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.post('/jobs/by-ids', async (req, res) => {
  try {
    const { ids } = req.body;
    const jobs = await jobService.getJobsByIds(ids || []);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.post('/jobs/report', async (req, res) => {
  try {
    const { jobId, jobTitle, reason, details, reporterId } = req.body;
    const report = new JobReportModel({
      jobId, jobTitle, reason, details, reporterId,
      status: 'pending'
    });
    await report.save();
    res.json({ message: 'Job reported successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to report job' });
  }
});

// Vercel Cron Route
app.get('/api/cron/refresh', async (req, res) => {
  // In a real app, verify a CRON_SECRET header from Vercel
  console.log('Cron job triggered: Refreshing cache');
  try {
    await jobService.refreshCache();
    res.json({ message: 'Cache refreshed' });
  } catch (error) {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

const port = process.env.PORT || 3000;

// Only listen if not running on Vercel
if (process.env['NODE_ENV'] !== 'production' || !process.env['VERCEL']) {
  const server = app.listen(port, () => {
    console.log(`Local server running at http://localhost:${port}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
  });
}

export default app;
