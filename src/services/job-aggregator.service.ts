import axios from 'axios';
import { Job } from '../models/job.model';
import Parser from 'rss-parser';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';

const TIMEOUT = 15000;
const rssParser = new Parser();

// MongoDB Schema for Jobs
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
  fetched_at: { type: Date, default: Date.now }
});

export const JobModel = mongoose.model('Job', JobSchema);

export class JobAggregatorService {

  async getJobsFromDB(keyword: string, location: string, userId?: string): Promise<Job[]> {
    console.log(`Searching DB for: "${keyword}" in "${location}"...`);
    const query: any = {};

    if (keyword) {
      query.$or = [
        { title: { $regex: keyword, $options: 'i' } },
        { company: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } }
      ];
    }

    if (location) {
      query.location = { $regex: location, $options: 'i' };
    }

    if (userId) {
      query.postedBy = userId;
    } else {
      // For general searches, only show jobs with valid URLs
      query.url = { $exists: true, $ne: '', $nin: ['#', null, 'N/A'] };
    }

    try {
      console.log('Executing find()...');
      const jobs = await JobModel.find(query).sort({ trusted_score: -1 }).lean();
      console.log(`Found ${jobs.length} jobs.`);
      return jobs as unknown as Job[];
    } catch (err: any) {
      console.error('DB Find Error:', err.message);
      throw err;
    }
  }

  async getJobsByIds(ids: string[]): Promise<Job[]> {
    console.log('getJobsByIds called with ids:', ids);
    if (!ids || ids.length === 0) return [];
    try {
      const jobs = await JobModel.find({ id: { $in: ids } }).lean();
      console.log(`Found ${jobs.length} jobs for saved ids.`);
      return jobs as unknown as Job[];
    } catch (err: any) {
      console.error('getJobsByIds Error:', err.message);
      return [];
    }
  }

  async refreshCache() {
    console.log('--- Refreshing Job Cache ---');
    try {
      const results = await Promise.allSettled([
        this.fetchHimalayas(''),
        this.fetchArbeitnow(),
        this.fetchRemotive(''),
        this.fetchJobicyRSS(),
        this.fetchPuffAndPass()
      ]);

      let allJobs: any[] = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          allJobs = [...allJobs, ...result.value];
        }
      });

      if (allJobs.length > 0) {
        // Drop existing aggregated jobs and insert new ones
        await JobModel.deleteMany({ isAggregated: true });

        // Deduplicate before inserting
        const seen = new Set();
        const filteredJobs = allJobs.filter(job => {
          if (!job.url || job.url === '#' || job.url === 'N/A' || job.url.trim() === '') return false;
          const key = `${job.title}-${job.company}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Filter out jobs that already exist in DB to avoid bulk write errors
        const jobIds = filteredJobs.map(j => j.id);
        const existingJobs = await JobModel.find({ id: { $in: jobIds } }, { id: 1 }).lean();
        const existingIds = new Set(existingJobs.map(j => j.id));

        const finalJobsToInsert = filteredJobs.filter(j => !existingIds.has(j.id));

        if (finalJobsToInsert.length > 0) {
          await JobModel.insertMany(finalJobsToInsert, { ordered: false });
          console.log(`Cache refreshed: ${finalJobsToInsert.length} new jobs stored in MongoDB`);
        } else {
          console.log('No new jobs to insert.');
        }
      }
    } catch (e: any) {
      console.error('Refresh cache failed:', e.message);
    }
  }

  // --- Source Fetchers ---

  private async fetchHimalayas(keyword: string): Promise<Job[]> {
    try {
      const url = `https://himalayas.app/jobs/api?limit=100`;
      const { data } = await axios.get(url, { timeout: TIMEOUT });
      return (data.jobs || []).map((j: any) => ({
        id: `himalayas-${j.guid}`,
        title: j.title,
        company: j.companyName,
        location: (j.locationRestrictions || []).join(', ') || 'Remote',
        remote: true,
        url: j.applicationLink,
        salary: this.formatSalary(j.minSalary, j.maxSalary, j.currency),
        source: 'Himalayas',
        date_posted: j.pubDate ? new Date(j.pubDate).toISOString() : new Date().toISOString(),
        description: j.description || '',
        trusted_score: 2,
      }));
    } catch (e) { return []; }
  }

  private async fetchArbeitnow(): Promise<Job[]> {
    try {
      const { data } = await axios.get('https://arbeitnow.com/api/job-board-api', { timeout: TIMEOUT });
      return (data.data || []).map((j: any) => ({
        id: `arbeitnow-${j.slug}`,
        title: j.title,
        company: j.company_name,
        location: j.location || 'Remote',
        remote: Boolean(j.remote),
        url: j.url,
        salary: 'N/A',
        source: 'Arbeitnow',
        date_posted: j.created_at ? new Date(j.created_at * 1000).toISOString() : new Date().toISOString(),
        description: j.description || '',
        trusted_score: 2,
      }));
    } catch (e) { return []; }
  }

  private async fetchRemotive(keyword: string): Promise<Job[]> {
    try {
      const { data } = await axios.get('https://remotive.com/api/remote-jobs?limit=50', { timeout: TIMEOUT });
      return (data.jobs || []).map((j: any) => ({
        id: `remotive-${j.id}`,
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || 'Remote',
        remote: true,
        url: j.url,
        salary: j.salary || 'N/A',
        source: 'Remotive',
        date_posted: j.publication_date ? new Date(j.publication_date).toISOString() : new Date().toISOString(),
        description: j.description || '',
        trusted_score: 2,
      }));
    } catch (e) { return []; }
  }

  private async fetchJobicyRSS(): Promise<Job[]> {
    try {
      const feed = await rssParser.parseURL('https://jobicy.com/?feed=job_feed');
      return (feed.items || []).map((item: any) => ({
        id: `jobicy-${item.guid || item.link}`,
        title: item.title,
        company: item.creator || 'Jobicy',
        location: 'Remote',
        remote: true,
        url: item.link,
        salary: 'N/A',
        source: 'Jobicy',
        date_posted: item.isoDate || new Date().toISOString(),
        description: item.content || '',
        trusted_score: 2,
      }));
    } catch (e) { return []; }
  }
  private async fetchPuffAndPass(): Promise<Job[]> {
    try {
      console.log('Fetching Puff and Pass jobs (categories and tags)...');
      const categories = [
        'internships',
        'learnerships',
        'apprenticeship',
        'bursaries',
        'graduate-programmes-2',
        'in-service-training'
      ];

      const tags = [
        'accounting',
        'finance',
        'information-technology',
        'computer-science',
        'financial-management',
        'information-systems',
        'human-resources-management',
        'electrical-engineering',
        'mechanical-engineering',
        'marketing'
      ];

      let allScrapedJobs: Job[] = [];
      const seenUrls = new Set<string>();

      const fetchPage = async (baseUrl: string, type: string, name: string) => {
        for (let page = 1; page <= 2; page++) {
          const url = page === 1 ? baseUrl : `${baseUrl}/page/${page}`;
          try {
            const { data } = await axios.get(url, {
              timeout: TIMEOUT,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            });
            const $ = cheerio.load(data);

            $('article, .post, .entry, .post-item, .listing-item').each((i, el) => {
              const titleElement = $(el).find('h2 a, h1 a, .entry-title a').first();
              const title = titleElement.text().trim();
              let jobUrl = titleElement.attr('href');

              if (!title || !jobUrl) return;
              if (!jobUrl.startsWith('http')) jobUrl = `https://www.puffandpass.co.za${jobUrl}`;
              if (seenUrls.has(jobUrl)) return;
              seenUrls.add(jobUrl);

              const contentText = $(el).text();

              let company = 'Puff & Pass';
              if (title.includes(':')) {
                company = title.split(':')[0].trim();
              }

              const locationMatch = contentText.match(/Location:\s*([^.\n]+)/i);
              const location = locationMatch ? locationMatch[1].trim() : 'South Africa';

              allScrapedJobs.push({
                id: `puffandpass-${Buffer.from(jobUrl).toString('hex')}`,
                title: title,
                company: company,
                location: location,
                remote: location.toLowerCase().includes('remote'),
                url: jobUrl,
                source: 'System',
                date_posted: new Date().toISOString(),
                description: contentText.substring(0, 500).trim() + '...',
                trusted_score: 3,
                tags: [name]
              });
            });
          } catch (err: any) {
            console.warn(`Failed to fetch ${url}: ${err.message}`);
          }
        }
      };

      for (const cat of categories) {
        await fetchPage(`https://www.puffandpass.co.za/category/${cat}`, 'category', cat);
      }

      for (const tag of tags) {
        await fetchPage(`https://www.puffandpass.co.za/tag/${tag}`, 'tag', tag);
      }

      console.log(`Scraped total ${allScrapedJobs.length} jobs from Puff and Pass`);
      return allScrapedJobs;
    } catch (e: any) {
      console.error('Puff and Pass Scrape Error:', e.message);
      return [];
    }
  }


  private formatSalary(min: any, max: any, cur: string): string {
    if (min && max) return `${cur || '$'} ${min.toLocaleString()} - ${max.toLocaleString()}`;
    if (min) return `${cur || '$'} ${min.toLocaleString()}+`;
    return 'N/A';
  }
}
