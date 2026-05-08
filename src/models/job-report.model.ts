import mongoose from 'mongoose';

const JobReportSchema = new mongoose.Schema({
  jobId: { type: String, required: true },
  jobTitle: { type: String, required: true },
  reporterId: { type: String }, // Optional: link to user if logged in
  reason: { type: String, required: true },
  details: { type: String },
  status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

export const JobReportModel = mongoose.model('JobReport', JobReportSchema);
