export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface QuestionModalConfig {
  title: string;
  prompt: string;
  options?: QuestionOption[];
  inputPlaceholder?: string;
  allowCustom?: boolean;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  timeout?: number;
}

export interface QuestionModalState {
  visible: boolean;
  config: QuestionModalConfig | null;
  selectedOption: number;
  inputText: string;
  cursorPos: number;
  createdAt: number;
}

export class QuestionModalManager {
  state: QuestionModalState = {
    visible: false,
    config: null,
    selectedOption: 0,
    inputText: "",
    cursorPos: 0,
    createdAt: 0,
  };

  show(config: QuestionModalConfig): void {
    this.state = {
      visible: true,
      config,
      selectedOption: 0,
      inputText: config.inputPlaceholder ? "" : "",
      cursorPos: 0,
      createdAt: Date.now(),
    };
  }

  hide(): void {
    this.state.visible = false;
    this.state.config = null;
  }

  selectNext(): void {
    if (!this.state.config?.options) return;
    this.state.selectedOption = (this.state.selectedOption + 1) % this.state.config.options.length;
  }

  selectPrev(): void {
    if (!this.state.config?.options) return;
    this.state.selectedOption = (this.state.selectedOption - 1 + this.state.config.options.length) % this.state.config.options.length;
  }

  submit(): void {
    if (!this.state.config) return;
    if (this.state.config.options) {
      const opt = this.state.config.options[this.state.selectedOption];
      this.state.config.onSubmit(opt.value);
    } else if (this.state.inputText.trim()) {
      this.state.config.onSubmit(this.state.inputText.trim());
    }
    this.hide();
  }

  cancel(): void {
    this.state.config?.onCancel?.();
    this.hide();
  }
}
