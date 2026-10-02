export interface TaskAttachment {
  id: string;
  task_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  /** Signed download URL — generated at read time, not stored */
  download_url?: string;
}
