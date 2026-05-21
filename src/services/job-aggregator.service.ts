import axios from 'axios';
import { Job, JobModel } from '../models/job.model';
import Parser from 'rss-parser';
import mongoose from 'mongoose';

const TIMEOUT = 15000;
const rssParser = new Parser();

// MongoDB Schema removed (now in models/job.model.ts)

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

  async getJobById(id: string): Promise<Job | null> {
    try {
      // Try finding by custom 'id' field first, then by MongoDB '_id'
      let job = await JobModel.findOne({ id }).lean();
      if (!job && mongoose.Types.ObjectId.isValid(id)) {
        job = await JobModel.findById(id).lean();
      }
      return job as unknown as Job;
    } catch (err: any) {
      console.error('getJobById Error:', err.message);
      return null;
    }
  }

  async refreshCache() {
    console.log('--- Refreshing Job Cache ---');
    try {
      const results = await Promise.allSettled([
        this.fetchHimalayas(''),
        this.fetchArbeitnow(),
        this.fetchRemotive(''),
        this.fetchJobicyRSS()
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
        const uniqueJobs = allJobs.filter(job => {
          // Skip jobs without valid application links
          if (!job.url || job.url === '#' || job.url === 'N/A' || job.url.trim() === '') return false;
          
          const key = `${job.title}-${job.company}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        await JobModel.insertMany(uniqueJobs, { ordered: false });
        console.log(`Cache refreshed: ${uniqueJobs.length} jobs stored in MongoDB`);
      }
    } catch (e: any) {
      console.error('Refresh cache failed:', e.message);
    }
  }

  // --- Source Fetchers ---

  extractRequirements(title: string, description: string): string[] {
    const reqs: string[] = [];
    
    // 1. Try to extract list items from description HTML if they look like requirements/skills
    if (description) {
      // Find list items: <li>...</li>
      const liMatches = description.match(/<li>(.*?)<\/li>/gi);
      if (liMatches) {
        liMatches.forEach(li => {
          // Remove HTML tags and decode basic entities
          let text = li.replace(/<\/?[^>]+(>|$)/g, "").replace(/&amp;/g, "&").trim();
          // Filter out short items, very long items, or items that aren't requirements
          if (text.length > 5 && text.length < 150) {
            // Avoid adding duplicate requirements (case-insensitive)
            if (!reqs.some(r => r.toLowerCase() === text.toLowerCase())) {
              reqs.push(text);
            }
          }
        });
      }
    }

    // 2. If we extracted less than 3 good requirements, let's supplement/generate realistic requirements
    if (reqs.length < 4) {
      const lowerTitle = title.toLowerCase();
      const lowerDesc = description ? description.toLowerCase() : '';
      
      const keywordMap: { keywords: string[], requirements: string[] }[] = [
        {
          keywords: ['angular'],
          requirements: [
            'Strong experience with Angular, TypeScript, and RxJS state management',
            'Proficiency in building responsive web UIs using HTML5, CSS3, and modern CSS preprocessors',
            'Understanding of front-end architecture, single-page application patterns, and component lifecycle',
            'Experience with Angular CLI, Unit Testing (Jasmine/Karma), and state management tools'
          ]
        },
        {
          keywords: ['react'],
          requirements: [
            'Solid experience with React.js, hooks, context API, and Redux or similar state management libraries',
            'Experience in designing modular, reusable component architectures',
            'Familiarity with modern bundlers (Webpack, Vite), Babel, and Jest for testing',
            'Understanding of virtual DOM, React rendering behavior, and performance optimization'
          ]
        },
        {
          keywords: ['vue'],
          requirements: [
            'Proficiency in Vue.js (Vue 2/3), Vuex/Pinia, and Vue Router',
            'Experience with modern frontend tooling (Vite, Webpack, ESLint)',
            'Strong understanding of Vue reactivity system, composables, and single-file components'
          ]
        },
        {
          keywords: ['javascript', 'frontend', 'front-end', 'front end', 'web developer', 'ui developer'],
          requirements: [
            'Strong proficiency in modern JavaScript (ES6+) and TypeScript',
            'Deep knowledge of web markup, CSS flexbox/grid layout systems, and cross-browser compatibility',
            'Familiarity with consuming RESTful and GraphQL APIs',
            'Experience using Git for version control and collaborating in team environments'
          ]
        },
        {
          keywords: ['node', 'backend', 'back-end', 'back end'],
          requirements: [
            'Hands-on experience with Node.js, Express.js, and backend architecture patterns',
            'Proficiency in RESTful API design, database integration (SQL/NoSQL like MongoDB, PostgreSQL)',
            'Understanding of asynchronous programming, event-driven systems, and middleware pipelines',
            'Familiarity with server deployment, cloud services (AWS/GCP), and basic Docker'
          ]
        },
        {
          keywords: ['python'],
          requirements: [
            'Strong proficiency in Python development with frameworks such as Django, Flask, or FastAPI',
            'Experience with object-oriented programming, data structures, and database integration',
            'Knowledge of automated unit testing frameworks and code linting',
            'Familiarity with writing efficient queries and database optimization'
          ]
        },
        {
          keywords: ['java'],
          requirements: [
            'Strong backend experience in Java, Spring Boot, and microservices architecture',
            'Understanding of RESTful services, database connections (Hibernate/JPA), and SQL databases',
            'Knowledge of object-oriented design patterns, dependency injection, and multithreading',
            'Experience with build tools like Maven or Gradle and CI/CD pipelines'
          ]
        },
        {
          keywords: ['c#', '.net'],
          requirements: [
            'Proficiency in C#, .NET Core, and Entity Framework Core',
            'Experience building web APIs, microservices, and background services',
            'Solid understanding of database systems (SQL Server, PostgreSQL) and clean architecture code'
          ]
        },
        {
          keywords: ['devops', 'cloud', 'aws', 'docker'],
          requirements: [
            'Experience with CI/CD implementation (GitHub Actions, GitLab CI, Jenkins)',
            'Familiarity with cloud hosting services, primarily AWS, Azure, or Google Cloud Platform',
            'Hands-on knowledge of containerization using Docker and orchestration tools (Kubernetes)',
            'Understanding of Infrastructure as Code (IaC) tools like Terraform or CloudFormation'
          ]
        },
        {
          keywords: ['fullstack', 'full-stack', 'full stack'],
          requirements: [
            'Comprehensive knowledge of both frontend frameworks (Angular/React/Vue) and backend runtimes (Node/Python/.NET)',
            'Experience with full-lifecycle software development: database design, API engineering, and responsive UI integration',
            'Familiarity with Git and package managers (npm, yarn)',
            'Familiarity with database setups, caching mechanisms, and hosting environments'
          ]
        }
      ];

      // Scan title & description to see which technical matchers fit
      for (const entry of keywordMap) {
        if (entry.keywords.some(k => lowerTitle.includes(k) || lowerDesc.includes(k))) {
          entry.requirements.forEach(req => {
            if (reqs.length < 6 && !reqs.some(r => r.toLowerCase() === req.toLowerCase())) {
              reqs.push(req);
            }
          });
        }
      }
      
      // General professional fallbacks to ensure we always have beautiful, realistic lists
      const generalFallbacks = [
        'Bachelor\'s degree in Computer Science, Information Technology, or equivalent practical experience',
        'Strong analytical thinking, problem-solving abilities, and attention to detail',
        'Excellent written and verbal communication skills, with a collaborative team spirit',
        'Ability to work independently, manage priority tasks, and deliver quality results'
      ];
      
      for (const req of generalFallbacks) {
        if (reqs.length < 5 && !reqs.some(r => r.toLowerCase() === req.toLowerCase())) {
          reqs.push(req);
        }
      }
    }

    // Limit to maximum 8 requirements to keep UI clean and consistent
    return reqs.slice(0, 8);
  }

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
        requirements: this.extractRequirements(j.title, j.description || '')
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
        requirements: this.extractRequirements(j.title, j.description || '')
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
        requirements: this.extractRequirements(j.title, j.description || '')
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
        requirements: this.extractRequirements(item.title, item.content || '')
      }));
    } catch (e) { return []; }
  }


  private formatSalary(min: any, max: any, cur: string): string {
    if (min && max) return `${cur || '$'} ${min.toLocaleString()} - ${max.toLocaleString()}`;
    if (min) return `${cur || '$'} ${min.toLocaleString()}+`;
    return 'N/A';
  }
}
