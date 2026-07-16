export interface HunkLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface Hunk {
  header: string;
  lines: HunkLine[];
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface FileDiff {
  filePath: string;
  status: 'modified' | 'added' | 'deleted';
  oldPath?: string;
  hunks: Hunk[];
  reviewed: boolean;
}

export interface DiffViewerState {
  visible: boolean;
  files: FileDiff[];
  selectedFileIndex: number;
  scrollOffset: number;
  fileTreeFocused: boolean;
  searchQuery: string;
}
