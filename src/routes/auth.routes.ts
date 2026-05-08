import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';
import { JobReportModel } from '../models/job-report.model';
import { JobAggregatorService } from '../services/job-aggregator.service';

import { emailService } from '../services/email.service';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'jobskomzansi_secret_123';

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user and send OTP
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    const existing = await UserModel.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const user = new UserModel({ 
      email, 
      password: hashedPassword, 
      name, 
      role: role || 'candidate', 
      isVerified: false, // Must verify via OTP
      otp,
      otpExpires
    });
    
    await user.save();

    // Send OTP email
    try {
      await emailService.sendOTP(email, otp);
    } catch (e) {
      console.error('Email send failed:', e);
      return res.status(500).json({ error: 'User created but failed to send verification email. Please try again later.' });
    }

    // If employer, send vetting notification
    if (user.role === 'employer') {
      try {
        await emailService.sendEmployerVettingNotification(email);
      } catch (e) {
        console.error('Employer notification failed:', e);
      }
    }

    res.json({ message: 'OTP sent to email. Please verify your account.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify account using OTP
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await UserModel.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });
    
    if (user.otp !== otp || (user.otpExpires && user.otpExpires < new Date())) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    
    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user.email, user.name || 'User');
    } catch (e) {
      console.error('Welcome email failed:', e);
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      message: 'Account verified successfully', 
      token, 
      user: { id: user._id, email: user.email, name: user.name, role: user.role, isVerified: user.isVerified, isVetted: user.isVetted, savedJobs: user.savedJobs } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     summary: Resend OTP to email
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await UserModel.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await emailService.sendOTP(email, otp);
    res.json({ message: 'New OTP sent to email' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login a user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully logged in
 *       400:
 *         description: Invalid credentials
 *       500:
 *         description: Login failed
 */
// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await UserModel.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    if (!user.isVerified) {
      // Send new OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      
      try {
        await emailService.sendOTP(user.email, otp);
      } catch (e) {
        console.error('Email send failed during login:', e);
        return res.status(500).json({ error: 'Account not verified and failed to send new OTP. Please try again later.' });
      }
      
      return res.status(403).json({ 
        error: 'Email not verified. A new OTP has been sent to your email.',
        needsVerification: true,
        email: user.email
      });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role, isVerified: user.isVerified, isVetted: user.isVetted, savedJobs: user.savedJobs } });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Middleware to protect routes
export const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = (decoded as any).userId;
        console.log('Token verified for userId:', req.userId);
        next();
    }
    catch (error: any) {
        console.error('Token verification failed:', error.message);
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Get current user profile
router.get('/me', authMiddleware, async (req: any, res: any) => {
  try {
    const user = await UserModel.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user._id,
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      isVerified: user.isVerified,
      isVetted: user.isVetted,
      vettingStatus: user.vettingStatus,
      rejectionReason: user.rejectionReason,
      savedJobs: user.savedJobs,
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * @swagger
 * /auth/save-job:
 *   post:
 *     summary: Save or unsave a job
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *             properties:
 *               jobId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Job saved/unsaved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to save job
 */
// Toggle Save Job
router.post('/save-job', authMiddleware, async (req: any, res: any) => {
  console.log('POST /auth/save-job received. JobId:', req.body.jobId, 'UserId:', req.userId);
  try {
    const { jobId } = req.body;
    const user = await UserModel.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const index = user.savedJobs.indexOf(jobId);
    if (index > -1) {
      user.savedJobs.splice(index, 1); // Unsave
    } else {
      user.savedJobs.push(jobId); // Save
    }

    await user.save();
    res.json({ savedJobs: user.savedJobs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save job' });
  }
});

/**
 * @swagger
 * /auth/saved-jobs:
 *   get:
 *     summary: Get user's saved jobs
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of saved job IDs
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to fetch saved jobs
 */
// Get Saved Jobs
router.get('/saved-jobs', authMiddleware, async (req: any, res: any) => {
  try {
    const user = await UserModel.findById(req.userId);
    res.json(user?.savedJobs || []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch saved jobs' });
  }
});

// Middleware to ensure user is an employer AND verified
export const employerMiddleware = async (req: any, res: any, next: any) => {
  const user = await UserModel.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  // Admins can also act as employers for testing/management
  if (user.role !== 'employer' && user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Employer or Admin role required.' });
  }

  if (!user.isVerified) {
    return res.status(403).json({ error: 'Please verify your email with the OTP sent to you.' });
  }

  // We only enforce vetting for creating new jobs
  const isApproved = user.isVetted || user.vettingStatus === 'approved' || user.role === 'admin';
  if (req.method === 'POST' && req.path.includes('/create') && !isApproved) {
    return res.status(403).json({ error: 'Your account is pending admin approval. You will be notified once you are vetted.' });
  }

  next();
};

// Middleware to ensure user is an admin
export const adminMiddleware = async (req: any, res: any, next: any) => {
  const user = await UserModel.findById(req.userId);
  if (user?.role !== 'admin') {
    console.warn(`Admin access denied for userId: ${req.userId} (Role: ${user?.role})`);
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  console.log(`Admin access granted for userId: ${req.userId}`);
  next();
};

import { JobModel } from '../services/job-aggregator.service';

/**
 * @swagger
 * /auth/jobs/create:
 *   post:
 *     summary: Create a new job listing (Employer only)
 *     tags: [Employer]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - location
 *             properties:
 *               title: { type: string }
 *               company: { type: string }
 *               location: { type: string }
 *               salary: { type: string }
 *               description: { type: string }
 *               remote: { type: boolean }
 *               url: { type: string }
 *     responses:
 *       201: { description: Job created }
 *       403: { description: Employer role required }
 */
router.post('/jobs/create', authMiddleware, employerMiddleware, async (req: any, res: any) => {
  try {
    const jobData = {
      ...req.body,
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: 'UserPosted',
      isAggregated: false,
      postedBy: req.userId,
      date_posted: new Date().toISOString(),
      trusted_score: 5 // User-posted jobs are highly trusted by default
    };
    const job = new JobModel(jobData);
    await job.save();
    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create job' });
  }
});

/**
 * @swagger
 * /auth/jobs/my-jobs:
 *   get:
 *     summary: Get jobs posted by the employer
 *     tags: [Employer]
 *     security:
 *       - bearerAuth: []
 */
router.get('/jobs/my-jobs', authMiddleware, employerMiddleware, async (req: any, res: any) => {
  try {
    const jobs = await JobModel.find({ postedBy: req.userId }).sort({ date_posted: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

/**
 * @swagger
 * /auth/jobs/:id:
 *   delete:
 *     summary: Delete a job listing
 *     tags: [Employer]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/jobs/:id', authMiddleware, employerMiddleware, async (req: any, res: any) => {
  try {
    const job = await JobModel.findOne({ _id: req.params.id, postedBy: req.userId });
    if (!job) return res.status(404).json({ error: 'Job not found or unauthorized' });
    
    await JobModel.deleteOne({ _id: req.params.id });
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// Admin Routes
router.get('/admin/unverified-employers', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  console.log('GET /admin/unverified-employers called by:', req.userId);
  try {
    const employers = await UserModel.find({ 
      role: 'employer', 
      isVerified: true, 
      vettingStatus: 'pending' 
    }).select('-password');
    console.log(`Found ${employers.length} unverified employers`);
    res.json(employers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch unverified employers' });
  }
});

router.get('/admin/approved-employers', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  console.log('GET /admin/approved-employers called by:', req.userId);
  try {
    const employers = await UserModel.find({ 
      role: 'employer', 
      vettingStatus: 'approved' 
    }).select('-password');
    console.log(`Found ${employers.length} approved employers`);
    res.json(employers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch approved employers' });
  }
});

router.get('/admin/rejected-employers', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  console.log('GET /admin/rejected-employers called by:', req.userId);
  try {
    const employers = await UserModel.find({ 
      role: 'employer', 
      vettingStatus: 'rejected' 
    }).select('-password');
    console.log(`Found ${employers.length} rejected employers`);
    res.json(employers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rejected employers' });
  }
});

router.post('/admin/verify-employer', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  console.log('POST /admin/verify-employer called with:', req.body);
  try {
    const { userId } = req.body;
    console.log('Verifying employer with ID:', userId);
    const user = await UserModel.findByIdAndUpdate(userId, { 
      isVerified: true, 
      isVetted: true,
      vettingStatus: 'approved'
    }, { new: true });
    
    if (!user) {
      console.warn('Verify failed: User not found for ID:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('User updated successfully. Sending email to:', user.email);
    // Send approval email
    await emailService.sendEmployerApproved(user.email);
    console.log('Approval email sent.');
    
    res.json({ message: 'Employer verified successfully', user: { id: user._id, isVerified: user.isVerified, vettingStatus: user.vettingStatus } });
  } catch (error: any) {
    console.error('Failed to verify employer:', error.message);
    res.status(500).json({ error: 'Failed to verify employer' });
  }
});

router.post('/admin/reject-employer', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  console.log('POST /admin/reject-employer called with:', req.body);
  try {
    const { userId, reason } = req.body;
    const user = await UserModel.findByIdAndUpdate(userId, { 
      vettingStatus: 'rejected',
      isVetted: true,
      rejectionReason: reason 
    }, { new: true });

    if (!user) {
      console.warn('Reject failed: User not found for ID:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User updated successfully. Sending rejection email to:', user.email);
    await emailService.sendEmployerRejected(user.email, reason);
    console.log('Rejection email sent.');

    res.json({ message: 'Employer rejected successfully' });
  } catch (error: any) {
    console.error('Failed to reject employer:', error.message);
    res.status(500).json({ error: 'Failed to reject employer' });
  }
});

router.get('/admin/reported-jobs', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  try {
    const reports = await JobReportModel.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reported jobs' });
  }
});

router.post('/admin/dismiss-report', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  try {
    const { reportId } = req.body;
    await JobReportModel.findByIdAndUpdate(reportId, { status: 'dismissed' });
    res.json({ message: 'Report dismissed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to dismiss report' });
  }
});

router.delete('/admin/delete-job/:jobId', authMiddleware, adminMiddleware, async (req: any, res: any) => {
  try {
    const { jobId } = req.params;
    const { reportId } = req.query;
    
    const jobService = new JobAggregatorService();
    // Assuming JobAggregatorService has a delete method or we use mongoose directly if it's a user-posted job
    // Let's use the DB directly for simplicity if it's in the 'jobs' collection
    const db = mongoose.connection.db;
    if (db) {
      await db.collection('jobs').deleteOne({ id: jobId });
    }

    if (reportId) {
      await JobReportModel.findByIdAndUpdate(reportId, { status: 'resolved' });
    }

    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

export default router;
