export interface Chat {
  id: number;
  dialogue_id: string;
  title: string;
  date: string;
  messages?: ChatMessage[];
  original?: string;
  tool_name?: string;
  isSending?: boolean; // 每个对话独立的发送状态
  messageInput?: string; // 每个对话独立的输入内容
  fileList?: UploadFile[]; // 每个对话独立的文件列表
  isFavorite: boolean; // 收藏状态
}

export interface ChatMessage {
  role: string;
  content: any;
  id?: string;
  steps?: any[];
  doc_list?: any[];
  tableHeaders?: Array<{
    prop: string;
    label: string;
  }>;
  instantMessage?: boolean;
  status?: string;
  upload_path?: string;
  download_path?: string; // 下载路径
  original?: string;
  tool_name?: string;
  followUpQuestions?: string[]; // 后续问题列表
  showFollowUpQuestions?: boolean; // 是否显示后续问题
  showLog?: boolean;
  attachedFiles?: UploadFile[]; // 附件文件列表
  compute_resource?: string; // 计算资源信息
  task_id?: string; // 任务ID
  server_file_path?: string; // 服务器文件路径
}

export interface ChatResponse {
  query: string;
  answer: string;
  id?: string;
  task_id?: string;
  tool_name?: string;
  status?: string;
  upload_path?: string;
  download_path?: string; // 下载路径
  steps?: any[];
  reaction_type?: string; // 添加点赞点踩状态字段
  compute_resource?: string; // 计算资源信息
  follow_up_questions?: string | string[]; // 后续问题列表
  server_file_path?: string; // 服务器文件路径
}

export interface UploadFile {
  name: string;
  size: number;
  type: string;
  file: File;
}
