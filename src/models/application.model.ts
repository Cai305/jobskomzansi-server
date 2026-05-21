import mongoose, { Schema, Document } from 'mongoose';

export interface IApplication extends Document {
  jobId: string;
  userId: mongoose.Types.ObjectId;
  candidateName: string;
  candidateEmail: string;
  resumeUrl: string;
  coverLetter?: string;
  status: 'pending' | 'reviewed' | 'shortlisted' | 'rejected' | 'accepted';
  appliedAt: Date;
  employerNotes?: string;
}

const ApplicationSchema: Schema = new Schema({
  jobId: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  resumeUrl: { type: String, required: true },
  coverLetter: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'reviewed', 'shortlisted', 'rejected', 'accepted'],
    default: 'pending' 
  },
  appliedAt: { type: Date, default: Date.now },
  employerNotes: { type: String }
});

export default mongoose.model<IApplication>('Application', ApplicationSchema);
