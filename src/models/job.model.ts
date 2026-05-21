import mongoose from 'mongoose';

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  salary?: string;
  source: string;
  date_posted: string;
  description?: string;
  trusted_score: number;
  tags?: string[];
  requirements?: string[];
  postedBy?: string;
  isAggregated?: boolean;
  applicationType?: 'internal' | 'external';
  externalApplyUrl?: string;
  contactEmail?: string;
}

const JobSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  title: String,
  company: String,
  location: String,
  remote: Boolean,
  url: String,
  salary: String,
  source: String,
  date_posted: String,
  description: String,
  trusted_score: Number,
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isAggregated: { type: Boolean, default: true },
  fetched_at: { type: Date, default: Date.now },
  applicationType: { type: String, enum: ['internal', 'external'], default: 'external' },
  externalApplyUrl: String,
  contactEmail: String,
  tags: [String],
  requirements: [String]
});

export const JobModel = mongoose.model('Job', JobSchema);
