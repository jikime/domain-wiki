export type ReviewItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  options?: unknown[];
  resolved: boolean;
  createdAt?: number;
  searchQueries?: string[];
};
