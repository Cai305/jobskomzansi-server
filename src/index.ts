import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { JobAggregatorService } from './services/job-aggregator.service';
import authRoutes from './routes/auth.routes';
import applicationRoutes from './routes/application.routes';
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
let connectionPromise: Promise<void> | null = null;
const connectDB = async () => {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;
  
  console.log('Connecting to MongoDB...');
  connectionPromise = (async () => {
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

    // Migration: Populate requirements for existing jobs that don't have them
    const { JobModel } = await import('./models/job.model');
    const jobsWithoutRequirements = await JobModel.find({
      $or: [
        { requirements: { $exists: false } },
        { requirements: { $size: 0 } }
      ]
    });
    if (jobsWithoutRequirements.length > 0) {
      console.log(`Migrating ${jobsWithoutRequirements.length} jobs to include requirements...`);
      let migratedCount = 0;
      for (const job of jobsWithoutRequirements) {
        const requirements = jobService.extractRequirements(job.title || '', job.description || '');
        if (requirements && requirements.length > 0) {
          await JobModel.updateOne({ _id: job._id }, { $set: { requirements } });
          migratedCount++;
        }
      }
      console.log(`Successfully migrated ${migratedCount} jobs with dynamic requirements`);
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
    connectionPromise = null;
    throw err;
  }
  })();
  return connectionPromise;
};

// Initialize DB connection
connectDB().catch(err => console.error('Initial DB connection failed:', err));

// Middleware to ensure DB connection is ready
app.use(async (req, res, next) => {
  if (!isConnected) {
    try {
      await connectDB();
    } catch (error: any) {
      const uriStart = MONGODB_URI.substring(0, 15);
      return res.status(503).json({ 
        error: 'Database connection failed. Please try again later.',
        details: error?.message || String(error),
        uriHint: uriStart,
        envVars: Object.keys(process.env).join(',')
      });
    }
  }
  next();
});

// Root route for health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'JobsKomzansi API is running' });
});

// Routes
app.use('/auth', authRoutes);
app.use('/applications', applicationRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

app.get('/job-details', async (req, res) => {
  try {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'Job ID is required' });
    const job = await jobService.getJobById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch job' });
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
