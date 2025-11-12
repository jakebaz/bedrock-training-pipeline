export interface TrainingExample {
  articleId: string;
  title: string;
  content: string;
  publication: string;
  publishedDate: string;
  metadata?: Record<string, any>;
}

export interface PromptExample {
  prompt: string;
  completion: string;
  metadata?: Record<string, any>;
}

export interface TrainingConfig {
  lookBackDays: number;
  publicationId?: string;
  trainingRunId: string;
  minPromptCount: number;
  trainingDataBucket: string;
  athenaDatabase: string;
  athenaTable: string;
  athenaWorkgroup: string;
  athenaOutputLocation: string;
}

export interface ProcessingResult {
  promptCount: number;
  s3Location: string;
  datasetVersion: string;
  processingTime: number;
  error?: string;
}
