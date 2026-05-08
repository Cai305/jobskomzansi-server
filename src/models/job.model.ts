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
}
