import express from 'express';
import Application from '../models/application.model';
import { JobModel } from '../models/job.model';
import { authMiddleware, employerMiddleware } from './auth.routes';
import { upload } from '../services/upload.service';
import { emailService } from '../services/email.service';

const router = express.Router();

// Apply for a job (Internal)
router.post('/apply', authMiddleware, upload.single('resume'), async (req: any, res: any) => {
  try {
    const { jobId, candidateName, candidateEmail, coverLetter } = req.body;
    
    // Check if job exists and is internal
    const job = await JobModel.findOne({ id: jobId });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.applicationType !== 'internal') {
      return res.status(400).json({ error: 'This job requires external application' });
    }

    // Check if already applied
    const existingApplication = await Application.findOne({ jobId, userId: req.userId });
    if (existingApplication) {
      return res.status(400).json({ error: 'You have already applied for this job' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Resume is required' });
    }

    const { storageService } = await import('../services/storage.service');
    const resumeUrl = await storageService.uploadFile(req.file, 'resumes');

    const application = new Application({
      jobId,
      userId: req.userId,
      candidateName,
      candidateEmail,
      resumeUrl,
      coverLetter,
      status: 'pending'
    });

    await application.save();

    // Notify employer if it's a user-posted job
    if (job.postedBy) {
       try {
        // Assuming we can find the employer's email
         const { UserModel } = await import('../models/user.model');
         const employer = await UserModel.findById(job.postedBy);
         if (employer && employer.email) {
           await emailService.sendApplicationNotification(employer.email, job.title!, candidateName);
         }
       } catch (e) {
         console.error('Failed to notify employer:', e);
       }
    }

    res.status(201).json({ message: 'Application submitted successfully', application });
  } catch (error: any) {
    console.error('Application error:', error);
    res.status(500).json({ error: 'Failed to submit application: ' + error.message });
  }
});

// Get applications for a job (Employer only)
router.get('/job/:jobId', authMiddleware, employerMiddleware, async (req: any, res: any) => {
  try {
    const { jobId } = req.params;
    
    // Ensure the job belongs to the employer
    const job = await JobModel.findOne({ id: jobId, postedBy: req.userId });
    if (!job) return res.status(403).json({ error: 'Unauthorized to view applications for this job' });

    const applications = await Application.find({ jobId }).sort({ appliedAt: -1 });
    res.json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Get my applications (Candidate)
router.get('/my-applications', authMiddleware, async (req: any, res: any) => {
  try {
    const applications = await Application.find({ userId: req.userId }).sort({ appliedAt: -1 });
    // Join with job data
    const jobIds = applications.map(a => a.jobId);
    const jobs = await JobModel.find({ id: { $in: jobIds } });
    
    const results = applications.map(app => ({
      ...app.toObject(),
      job: jobs.find(j => j.id === app.jobId)
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch your applications' });
  }
});

// Update application status (Employer)
router.patch('/:id/status', authMiddleware, employerMiddleware, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { status, employerNotes } = req.body;

    const application = await Application.findById(id);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    // Ensure the job belongs to the employer
    const job = await JobModel.findOne({ id: application.jobId, postedBy: req.userId });
    if (!job) return res.status(403).json({ error: 'Unauthorized to update this application' });

    application.status = status;
    if (employerNotes) application.employerNotes = employerNotes;
    await application.save();

    // Notify candidate
    try {
      await emailService.sendApplicationStatusUpdate(application.candidateEmail!, job.title!, status);
    } catch (e) {
      console.error('Failed to notify candidate of status update:', e);
    }

    res.json({ message: 'Application status updated', application });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update application status' });
  }
});

export default router;
