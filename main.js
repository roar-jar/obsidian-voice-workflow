const {
  FileSystemAdapter,
  ItemView,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
} = require("obsidian");

const VIEW_TYPE = "voice-summary-sidebar";
const VIEW_NAME = "Voice Workflow";
const TEMPLATE_CUSTOM_VALUE = "__custom__";

const DEFAULT_SUMMARY_TEMPLATE = [
  "## 한줄 요약",
  "",
  "## 핵심 포인트",
  "- ",
  "",
  "## 실행 항목",
  "- [ ] ",
  "",
  "## 후속 질문",
  "- ",
].join("\n");

const DEFAULT_CONSENT_MESSAGE =
  "이 회의는 Voice Workflow로 녹음 및 전사하여 회의록을 작성하려고 합니다. 녹음과 전사에 동의하시나요?";

const DEFAULT_STATUS_MESSAGE =
  "우측 패널에서 녹음한 뒤 템플릿과 저장 노트를 선택해 요약을 만들 수 있습니다.";

const SUMMARY_PLACEHOLDER = "_최종 요약을 아직 생성하지 않았습니다._";
const RECORDING_METADATA_HEADING = "녹음 메타데이터";
const RECORDING_ARCHIVE_HEADING = "원문 전사 및 저장 내역";
const TRANSCRIPT_HEADING = "원문 전사";
const TRANSLATED_TRANSCRIPT_HEADING = "번역 전사 (한국어)";
const SUMMARY_HEADING = "템플릿 요약";
const LIVE_TRANSCRIPT_COMMIT_INTERVAL_MS = 50 * 1000;
const PREVIEW_TRANSCRIPT_INTERVAL_MS = 12 * 1000;
const PREVIEW_TRANSCRIPT_MIN_SECONDS = 6;
const AUDIO_PROCESSOR_BUFFER_SIZE = 16384;
const MAX_TRANSCRIPT_FEED_ITEMS = 80;

const AI_PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI Compatible" },
  { value: "ollama", label: "Ollama Local" },
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
];

const AGENT_INSTRUCTION_OPTIONS = [
  {
    value: "auto",
    label: "자동",
    prompt:
      "회의 유형을 스스로 판단하고, 논의 맥락에 맞게 핵심 요약, 결정사항, 실행 항목, 후속 질문을 균형 있게 정리한다.",
  },
  {
    value: "meeting",
    label: "일반 회의",
    prompt:
      "일반 업무 회의록으로 정리한다. 논의 배경, 핵심 쟁점, 결정사항, 실행 항목, 담당자, 기한, 미해결 질문을 분리한다.",
  },
  {
    value: "lecture",
    label: "강의/수업",
    prompt:
      "강의 노트로 정리한다. 개념, 예시, 교수자 강조점, 학생이 복습할 질문, 과제나 다음 수업 준비 항목을 분리한다.",
  },
  {
    value: "one-on-one",
    label: "1:1",
    prompt:
      "1:1 미팅 기록으로 정리한다. 상태 공유, 고민, 피드백, 합의한 다음 행동, 민감한 내용의 표현 수위를 조심스럽게 정리한다.",
  },
  {
    value: "decision",
    label: "의사결정",
    prompt:
      "의사결정 회의록으로 정리한다. 선택지, 판단 근거, 최종 결정, 반대 의견, 리스크, 후속 검증 항목을 명확히 구분한다.",
  },
  {
    value: "custom",
    label: "커스텀",
    prompt: "",
  },
];

const STT_PROVIDER_OPTIONS = [
  { value: "auto", label: "Auto (OS Default)" },
  { value: "macos-speech", label: "macOS Local Speech" },
  { value: "windows-speech", label: "Windows Speech" },
  { value: "openai", label: "OpenAI Compatible API" },
];

const AI_PROVIDER_MAP = AI_PROVIDER_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.value] = option;
  return accumulator;
}, {});

const AGENT_INSTRUCTION_MAP = AGENT_INSTRUCTION_OPTIONS.reduce(
  (accumulator, option) => {
    accumulator[option.value] = option;
    return accumulator;
  },
  {}
);

const STT_PROVIDER_MAP = STT_PROVIDER_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.value] = option;
  return accumulator;
}, {});

const LANGUAGE_OPTIONS = [
  {
    value: "auto",
    label: "Auto-detect",
    speechRecognition: "",
    openai: "",
    macLocale: "auto",
  },
  {
    value: "en",
    label: "English",
    speechRecognition: "en-US",
    openai: "en",
    macLocale: "en-US",
  },
  {
    value: "zh",
    label: "Chinese",
    speechRecognition: "zh-CN",
    openai: "zh",
    macLocale: "zh-CN",
  },
  {
    value: "de",
    label: "German",
    speechRecognition: "de-DE",
    openai: "de",
    macLocale: "de-DE",
  },
  {
    value: "es",
    label: "Spanish",
    speechRecognition: "es-ES",
    openai: "es",
    macLocale: "es-ES",
  },
  {
    value: "ru",
    label: "Russian",
    speechRecognition: "ru-RU",
    openai: "ru",
    macLocale: "ru-RU",
  },
  {
    value: "ko",
    label: "Korean",
    speechRecognition: "ko-KR",
    openai: "ko",
    macLocale: "ko-KR",
  },
  {
    value: "fr",
    label: "French",
    speechRecognition: "fr-FR",
    openai: "fr",
    macLocale: "fr-FR",
  },
  {
    value: "ja",
    label: "Japanese",
    speechRecognition: "ja-JP",
    openai: "ja",
    macLocale: "ja-JP",
  },
];

const LANGUAGE_MAP = LANGUAGE_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.value] = option;
  return accumulator;
}, {});

function getDefaultSttProvider() {
  return "auto";
}

function getPlatformSttProvider() {
  if (Platform.isMacOS) {
    return "macos-speech";
  }

  if (Platform.isWin) {
    return "windows-speech";
  }

  return "openai";
}

function normalizeSttProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  return STT_PROVIDER_MAP[raw] ? raw : getDefaultSttProvider();
}

function normalizeAiProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  return AI_PROVIDER_MAP[raw] ? raw : "openai";
}

function normalizeAgentInstruction(value) {
  const raw = String(value || "").trim().toLowerCase();
  return AGENT_INSTRUCTION_MAP[raw] ? raw : "meeting";
}

function normalizeLanguageKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "auto";
  }

  if (LANGUAGE_MAP[raw]) {
    return raw;
  }

  if (raw.startsWith("ko")) {
    return "ko";
  }
  if (raw.startsWith("en")) {
    return "en";
  }
  if (raw.startsWith("zh")) {
    return "zh";
  }
  if (raw.startsWith("de")) {
    return "de";
  }
  if (raw.startsWith("es")) {
    return "es";
  }
  if (raw.startsWith("ru")) {
    return "ru";
  }
  if (raw.startsWith("fr")) {
    return "fr";
  }
  if (raw.startsWith("ja")) {
    return "ja";
  }

  return "auto";
}

function getErrorText(error) {
  if (error == null) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message || String(error);
  }

  return String(error);
}

function createTaggedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function isNoSpeechError(error) {
  const message = getErrorText(error).toLowerCase();
  return (
    message.includes("no speech detected") ||
    message.includes("empty transcript") ||
    message.includes("returned an empty transcript") ||
    message.includes("음성이 감지되지 않았습니다") ||
    message.includes("전사 결과가 비어 있습니다") ||
    message.includes("(-2700)")
  );
}

function isSpeechPermissionError(error) {
  const message = getErrorText(error).toLowerCase();
  return (
    message.includes("authorization was denied") ||
    message.includes("speech recognition authorization was denied") ||
    message.includes("speech recognition' 권한") ||
    message.includes("speech recognition 권한") ||
    message.includes("privacy & security > speech recognition") ||
    message.includes("개인정보 보호 및 보안 > speech recognition")
  );
}

function isRecoverableSpeechError(error) {
  return isNoSpeechError(error) || isSpeechPermissionError(error);
}

function isMicrophonePermissionError(error) {
  const message = getErrorText(error).toLowerCase();
  return (
    message.includes("notallowederror") ||
    message.includes("permission denied") ||
    message.includes("microphone") ||
    message.includes("마이크 권한") ||
    message.includes("permissions policy")
  );
}

const DEFAULT_SETTINGS = {
  sttProvider: getDefaultSttProvider(),
  aiProvider: "openai",
  apiKey: "",
  apiBaseUrl: "https://api.openai.com/v1",
  transcriptionModel: "gpt-4o-mini-transcribe",
  summaryModel: "gpt-4o-mini",
  openAiApiKey: "",
  openAiApiBaseUrl: "https://api.openai.com/v1",
  openAiTranscriptionModel: "gpt-4o-mini-transcribe",
  openAiSummaryModel: "gpt-4o-mini",
  ollamaApiBaseUrl: "http://localhost:11434",
  ollamaModel: "qwen3",
  anthropicApiKey: "",
  anthropicApiBaseUrl: "https://api.anthropic.com/v1",
  anthropicModel: "claude-sonnet-4-20250514",
  geminiApiKey: "",
  geminiApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-2.5-flash",
  sourceLanguage: "auto",
  transcriptionLanguage: "",
  translateToKorean: false,
  selectedTemplatePath: "",
  customSummaryTemplate: DEFAULT_SUMMARY_TEMPLATE,
  summaryTemplate: DEFAULT_SUMMARY_TEMPLATE,
  defaultAgentInstruction: "meeting",
  customAgentInstruction: "",
  requireConsentBeforeRecording: true,
  consentMessage: DEFAULT_CONSENT_MESSAGE,
  noteFolder: "Voice Workflow/Notes",
  audioFolder: "Voice Workflow/Audio",
  openSidebarOnStartup: false,
};

module.exports = class VoiceSummaryWorkflowPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.markdownFileCache = null;

    this.registerView(
      VIEW_TYPE,
      (leaf) => new VoiceSummarySidebarView(leaf, this)
    );

    this.addRibbonIcon("mic", "Voice Workflow 열기", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-voice-summary-workflow-sidebar",
      name: "사이드바 열기",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "open-voice-summary-workflow",
      name: "사이드바 열기 (기존 명령 호환)",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new VoiceSummaryWorkflowSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", () => this.invalidateMarkdownFileCache())
      );
      this.registerEvent(
        this.app.vault.on("delete", () => this.invalidateMarkdownFileCache())
      );
      this.registerEvent(
        this.app.vault.on("rename", () => this.invalidateMarkdownFileCache())
      );

      if (this.settings.openSidebarOnStartup) {
        void this.activateView();
      }
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  invalidateMarkdownFileCache() {
    this.markdownFileCache = null;
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        throw new Error("우측 사이드바 leaf를 만들지 못했습니다.");
      }

      await leaf.setViewState({
        type: VIEW_TYPE,
        active: true,
      });
    }

    this.app.workspace.revealLeaf(leaf);
    return leaf.view;
  }

  async loadSettings() {
    const loaded = (await this.loadData()) || {};
    const sourceLanguage =
      loaded.sourceLanguage ||
      normalizeLanguageKey(loaded.transcriptionLanguage) ||
      DEFAULT_SETTINGS.sourceLanguage;
    const customSummaryTemplate =
      loaded.customSummaryTemplate ||
      loaded.summaryTemplate ||
      DEFAULT_SETTINGS.customSummaryTemplate;

    const aiProvider = normalizeAiProvider(loaded.aiProvider);
    const sttProvider = normalizeSttProvider(loaded.sttProvider);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded, {
      aiProvider,
      sttProvider,
      sourceLanguage,
      openAiApiKey: loaded.openAiApiKey || loaded.apiKey || DEFAULT_SETTINGS.openAiApiKey,
      openAiApiBaseUrl:
        loaded.openAiApiBaseUrl || loaded.apiBaseUrl || DEFAULT_SETTINGS.openAiApiBaseUrl,
      openAiTranscriptionModel:
        loaded.openAiTranscriptionModel ||
        loaded.transcriptionModel ||
        DEFAULT_SETTINGS.openAiTranscriptionModel,
      openAiSummaryModel:
        loaded.openAiSummaryModel ||
        loaded.summaryModel ||
        DEFAULT_SETTINGS.openAiSummaryModel,
      ollamaApiBaseUrl:
        loaded.ollamaApiBaseUrl || DEFAULT_SETTINGS.ollamaApiBaseUrl,
      ollamaModel: loaded.ollamaModel || DEFAULT_SETTINGS.ollamaModel,
      customSummaryTemplate,
      summaryTemplate: customSummaryTemplate,
      defaultAgentInstruction: normalizeAgentInstruction(
        loaded.defaultAgentInstruction || DEFAULT_SETTINGS.defaultAgentInstruction
      ),
      consentMessage:
        loaded.consentMessage || DEFAULT_SETTINGS.consentMessage,
    });
  }

  async saveSettings() {
    this.settings.aiProvider = normalizeAiProvider(this.settings.aiProvider);
    this.settings.sttProvider = normalizeSttProvider(this.settings.sttProvider);
    this.settings.sourceLanguage = normalizeLanguageKey(this.settings.sourceLanguage);
    this.settings.transcriptionLanguage =
      this.resolveOpenAiLanguage(this.settings.sourceLanguage);
    this.settings.openAiApiKey = String(this.settings.openAiApiKey || "").trim();
    this.settings.openAiApiBaseUrl =
      String(this.settings.openAiApiBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.openAiApiBaseUrl;
    this.settings.openAiTranscriptionModel =
      String(this.settings.openAiTranscriptionModel || "").trim() ||
      DEFAULT_SETTINGS.openAiTranscriptionModel;
    this.settings.openAiSummaryModel =
      String(this.settings.openAiSummaryModel || "").trim() ||
      DEFAULT_SETTINGS.openAiSummaryModel;
    this.settings.ollamaApiBaseUrl =
      String(this.settings.ollamaApiBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.ollamaApiBaseUrl;
    this.settings.ollamaModel =
      String(this.settings.ollamaModel || "").trim() || DEFAULT_SETTINGS.ollamaModel;
    this.settings.anthropicApiKey = String(this.settings.anthropicApiKey || "").trim();
    this.settings.anthropicApiBaseUrl =
      String(this.settings.anthropicApiBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.anthropicApiBaseUrl;
    this.settings.anthropicModel =
      String(this.settings.anthropicModel || "").trim() ||
      DEFAULT_SETTINGS.anthropicModel;
    this.settings.geminiApiKey = String(this.settings.geminiApiKey || "").trim();
    this.settings.geminiApiBaseUrl =
      String(this.settings.geminiApiBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.geminiApiBaseUrl;
    this.settings.geminiModel =
      String(this.settings.geminiModel || "").trim() || DEFAULT_SETTINGS.geminiModel;
    this.settings.defaultAgentInstruction = normalizeAgentInstruction(
      this.settings.defaultAgentInstruction
    );
    this.settings.customAgentInstruction = String(
      this.settings.customAgentInstruction || ""
    ).trim();
    this.settings.consentMessage =
      String(this.settings.consentMessage || "").trim() ||
      DEFAULT_SETTINGS.consentMessage;
    this.settings.requireConsentBeforeRecording = Boolean(
      this.settings.requireConsentBeforeRecording
    );
    // Keep legacy keys in sync for backward compatibility with older data files.
    this.settings.apiKey = this.settings.openAiApiKey;
    this.settings.apiBaseUrl = this.settings.openAiApiBaseUrl;
    this.settings.transcriptionModel = this.settings.openAiTranscriptionModel;
    this.settings.summaryModel = this.settings.openAiSummaryModel;
    this.settings.summaryTemplate =
      this.settings.customSummaryTemplate || DEFAULT_SETTINGS.customSummaryTemplate;
    await this.saveData(this.settings);
  }

  getLanguageOptions() {
    return LANGUAGE_OPTIONS;
  }

  getSttProviderOptions() {
    return STT_PROVIDER_OPTIONS;
  }

  getConfiguredSttProvider() {
    return normalizeSttProvider(this.settings.sttProvider);
  }

  getResolvedSttProvider() {
    const configured = this.getConfiguredSttProvider();
    if (configured === "auto") {
      return getPlatformSttProvider();
    }

    if (configured === "macos-speech") {
      return Platform.isMacOS ? configured : "openai";
    }

    if (configured === "windows-speech") {
      return Platform.isWin ? configured : "openai";
    }

    return configured;
  }

  getSttProviderLabel(value) {
    return (
      STT_PROVIDER_MAP[normalizeSttProvider(value)]?.label ||
      STT_PROVIDER_MAP[getDefaultSttProvider()].label
    );
  }

  getAiProviderOptions() {
    return AI_PROVIDER_OPTIONS;
  }

  getAgentInstructionOptions() {
    return AGENT_INSTRUCTION_OPTIONS;
  }

  getAiProviderLabel(value) {
    return AI_PROVIDER_MAP[normalizeAiProvider(value)]?.label || AI_PROVIDER_MAP.openai.label;
  }

  getAgentInstructionLabel(value) {
    return (
      AGENT_INSTRUCTION_MAP[normalizeAgentInstruction(value)]?.label ||
      AGENT_INSTRUCTION_MAP.meeting.label
    );
  }

  getActiveAiProvider() {
    return normalizeAiProvider(this.settings.aiProvider);
  }

  providerRequiresApiKey(provider = this.getActiveAiProvider()) {
    return normalizeAiProvider(provider) !== "ollama";
  }

  getActiveAiApiKey() {
    switch (this.getActiveAiProvider()) {
      case "anthropic":
        return String(this.settings.anthropicApiKey || "").trim();
      case "gemini":
        return String(this.settings.geminiApiKey || "").trim();
      case "ollama":
        return "";
      case "openai":
      default:
        return String(this.settings.openAiApiKey || "").trim();
    }
  }

  getActiveAiModel() {
    switch (this.getActiveAiProvider()) {
      case "anthropic":
        return String(this.settings.anthropicModel || "").trim();
      case "gemini":
        return String(this.settings.geminiModel || "").trim();
      case "ollama":
        return String(this.settings.ollamaModel || "").trim();
      case "openai":
      default:
        return String(this.settings.openAiSummaryModel || "").trim();
    }
  }

  getAiUnavailableReason() {
    const provider = this.getActiveAiProvider();
    const label = this.getAiProviderLabel(provider);
    if (!this.getActiveAiModel()) {
      return `${label} 모델이 설정되지 않았습니다.`;
    }
    if (this.providerRequiresApiKey(provider) && !this.getActiveAiApiKey()) {
      return `${label} API Key가 설정되지 않았습니다.`;
    }
    return "";
  }

  getOpenAiApiKey() {
    return String(this.settings.openAiApiKey || "").trim();
  }

  getOpenAiApiBaseUrl() {
    return (
      String(this.settings.openAiApiBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.openAiApiBaseUrl
    );
  }

  getOllamaApiBaseUrl() {
    return (
      String(this.settings.ollamaApiBaseUrl || "").trim() ||
      DEFAULT_SETTINGS.ollamaApiBaseUrl
    );
  }

  getOpenAiTranscriptionModel() {
    return (
      String(this.settings.openAiTranscriptionModel || "").trim() ||
      DEFAULT_SETTINGS.openAiTranscriptionModel
    );
  }

  getResolvedSttModelLabel() {
    const provider = this.getResolvedSttProvider();
    if (provider === "openai") {
      return this.getOpenAiTranscriptionModel();
    }
    if (provider === "macos-speech") {
      return "macOS Speech.framework";
    }
    if (provider === "windows-speech") {
      return "Windows SpeechRecognition";
    }
    return provider;
  }

  getLanguageLabel(value) {
    return (
      LANGUAGE_MAP[normalizeLanguageKey(value)]?.label || LANGUAGE_MAP.auto.label
    );
  }

  resolveSpeechRecognitionLanguage(value) {
    return (
      LANGUAGE_MAP[normalizeLanguageKey(value)]?.speechRecognition || ""
    );
  }

  resolveOpenAiLanguage(value) {
    const fromMap = LANGUAGE_MAP[normalizeLanguageKey(value)]?.openai;
    if (fromMap) {
      return fromMap;
    }

    const raw = String(value || "").trim().toLowerCase();
    if (/^[a-z]{2,3}$/.test(raw)) {
      return raw;
    }
    if (/^[a-z]{2,3}-/.test(raw)) {
      return raw.slice(0, 2);
    }

    return "";
  }

  resolveMacLocale(value) {
    const fromMap = LANGUAGE_MAP[normalizeLanguageKey(value)]?.macLocale;
    if (fromMap) {
      return fromMap;
    }

    const raw = String(value || "").trim();
    return raw || "auto";
  }

  async createMemoFromRecording({
    audioBlob,
    title,
    topic,
    sourceLanguage,
    previewTranscript,
    translateToKorean,
  }) {
    const createdAt = new Date();
    const targetNoteFile = await this.getOrCreateWorkingNote(title, createdAt);
    const currentContent = await this.readNoteContent(targetNoteFile);
    const noteTitle =
      this.extractFirstHeading(currentContent) ||
      targetNoteFile.basename ||
      `음성 메모 ${this.formatTimestamp(createdAt)}`;
    const fileBaseName = `${this.formatFileTimestamp(createdAt)} ${this.sanitizeFileName(
      noteTitle
    )}`;

    await this.ensureFolder(this.settings.audioFolder);

    const audioPath = await this.getAvailablePath(
      this.settings.audioFolder,
      fileBaseName,
      ".wav"
    );
    await this.writeBinaryFile(audioPath, audioBlob);

    let resolvedTranscript = "";
    let transcriptError = null;

    try {
      resolvedTranscript = await this.transcribeAudio({
        audioBlob,
        audioPath,
        language: sourceLanguage,
        previewTranscript,
      });
    } catch (error) {
      transcriptError = error;
      resolvedTranscript = this.normalizeText(previewTranscript);
      if (!resolvedTranscript) {
        throw error;
      }
    }

    let translatedTranscript = "";
    let translationError = null;

    if (translateToKorean && normalizeLanguageKey(sourceLanguage) !== "ko") {
      try {
        translatedTranscript = await this.translateTranscriptToKorean({
          transcript: resolvedTranscript,
          sourceLanguage,
        });
      } catch (error) {
        translationError = error;
      }
    }

    const updatedContent = this.appendRecordingToNote(currentContent, {
      createdAt,
      topic,
      audioPath,
      sourceLanguage,
      transcript: resolvedTranscript,
      translatedTranscript,
    });

    await this.writeNoteContent(targetNoteFile, updatedContent);

    return {
      noteFile: targetNoteFile,
      audioPath,
      transcript: resolvedTranscript,
      translatedTranscript,
      translationError,
      transcriptError,
    };
  }

  async getOrCreateWorkingNote(title, createdAt) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && activeFile.extension === "md") {
      return activeFile;
    }

    await this.ensureFolder(this.settings.noteFolder);
    const resolvedTitle = title || `음성 메모 ${this.formatTimestamp(createdAt)}`;
    const fileBaseName = `${this.formatFileTimestamp(createdAt)} ${this.sanitizeFileName(
      resolvedTitle
    )}`;
    const notePath = await this.getAvailablePath(
      this.settings.noteFolder,
      fileBaseName,
      ".md"
    );
    const noteFile = await this.app.vault.create(notePath, `# ${resolvedTitle}\n`);
    await this.app.workspace.getLeaf(true).openFile(noteFile);
    return noteFile;
  }

  getOpenMarkdownViews(filePath) {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .filter((view) => view?.file?.path === filePath);
  }

  async readNoteContent(noteFile) {
    const openViews = this.getOpenMarkdownViews(noteFile.path);

    for (const view of openViews) {
      if (typeof view.getViewData === "function") {
        const value = view.getViewData();
        if (typeof value === "string") {
          return value;
        }
      }
      if (view.editor && typeof view.editor.getValue === "function") {
        return view.editor.getValue();
      }
    }

    return this.app.vault.cachedRead(noteFile);
  }

  async writeNoteContent(noteFile, content) {
    const normalizedContent = String(content || "");
    const openViews = this.getOpenMarkdownViews(noteFile.path);

    for (const view of openViews) {
      if (typeof view.setViewData === "function") {
        await view.setViewData(normalizedContent, false);
      } else if (view.editor && typeof view.editor.setValue === "function") {
        view.editor.setValue(normalizedContent);
      }
    }

    await this.app.vault.process(noteFile, () => normalizedContent);

    for (const view of openViews) {
      if (typeof view.save === "function") {
        await view.save();
      }
    }
  }

  async applyFrontmatterEntriesToFile(noteFile, entries) {
    const normalizedEntries = Array.isArray(entries)
      ? entries.filter((entry) => entry && entry.key)
      : [];

    if (normalizedEntries.length === 0) {
      return;
    }

    await this.app.fileManager.processFrontMatter(noteFile, (frontmatter) => {
      for (const entry of normalizedEntries) {
        frontmatter[entry.key] = this.getFrontmatterEntryData(entry);
      }
    });
  }

  getFrontmatterEntryData(entry) {
    if (Object.prototype.hasOwnProperty.call(entry, "data")) {
      return entry.data;
    }
    return this.parseFrontmatterEntryValue(entry.value);
  }

  parseFrontmatterEntryValue(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    if (raw === "[]") {
      return [];
    }
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      return Number(raw);
    }
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch (error) {
        return raw.slice(1, -1);
      }
    }
    return raw;
  }

  appendRecordingToNote(
    content,
    {
      createdAt,
      topic,
      audioPath,
      sourceLanguage,
      transcript,
      translatedTranscript,
    }
  ) {
    const entry = this.buildRecordingArchiveEntry({
      createdAt,
      topic,
      audioPath,
      sourceLanguage,
      transcript,
      translatedTranscript,
    });
    const cleanedContent = this.removeLegacyRecordingSections(content);
    const { frontmatter, body } = this.splitFrontmatter(cleanedContent);
    const existingArchive = this.extractTrailingSectionBody(
      body,
      RECORDING_ARCHIVE_HEADING
    );
    const archiveBody = [this.normalizeArchiveMarkup(existingArchive), entry]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const withoutArchiveBody = this.removeTrailingSection(body, RECORDING_ARCHIVE_HEADING);
    const nextBody = this.appendTrailingSection(
      withoutArchiveBody,
      RECORDING_ARCHIVE_HEADING,
      archiveBody
    );
    return [
      frontmatter ? `${frontmatter}\n` : "",
      nextBody,
      "",
    ]
      .filter(Boolean)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async transcribeAudio({ audioBlob, audioPath, language, previewTranscript }) {
    const provider = this.getResolvedSttProvider();

    if (provider === "macos-speech") {
      return this.transcribeWithMacOsSpeech(audioPath, language);
    }

    if (provider === "windows-speech") {
      return this.transcribeWithWindowsSpeech({
        audioBlob,
        audioPath,
        language,
        previewTranscript,
      });
    }

    return this.transcribeWithOpenAi(
      audioBlob,
      this.basename(audioPath),
      language
    );
  }

  async transcribeWithOpenAi(audioBlob, filename, language) {
    const apiKey = this.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OpenAI API Key가 설정되지 않았습니다.");
    }

    const fields = [
      { name: "model", value: this.getOpenAiTranscriptionModel() },
      { name: "response_format", value: "json" },
    ];
    const resolvedLanguage = this.resolveOpenAiLanguage(language);
    if (resolvedLanguage) {
      fields.push({ name: "language", value: resolvedLanguage });
    }

    const multipart = await this.buildMultipartBody({
      fields,
      file: {
        name: "file",
        filename,
        blob: audioBlob,
        contentType: audioBlob.type || "audio/wav",
      },
    });

    const response = await requestUrl({
      url: this.buildOpenAiApiUrl("/audio/transcriptions"),
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": multipart.contentType,
      },
      body: multipart.body,
      throw: false,
    });

    const data = await this.parseRequestUrlResponse(response, "STT 요청");
    const transcript = typeof data.text === "string" ? data.text.trim() : "";

    if (!transcript) {
      throw new Error("STT 응답에 text 필드가 없습니다.");
    }

    return transcript;
  }

  async buildMultipartBody({ fields, file }) {
    const boundary = `----voice-workflow-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const encoder = new TextEncoder();
    const chunks = [];
    const pushString = (value) => {
      chunks.push(encoder.encode(value));
    };

    for (const field of fields || []) {
      pushString(`--${boundary}\r\n`);
      pushString(
        `Content-Disposition: form-data; name="${this.escapeHeaderValue(
          field.name
        )}"\r\n\r\n`
      );
      pushString(`${String(field.value || "")}\r\n`);
    }

    const fileBuffer = await file.blob.arrayBuffer();
    pushString(`--${boundary}\r\n`);
    pushString(
      `Content-Disposition: form-data; name="${this.escapeHeaderValue(
        file.name
      )}"; filename="${this.escapeHeaderValue(file.filename)}"\r\n`
    );
    pushString(`Content-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`);
    chunks.push(new Uint8Array(fileBuffer));
    pushString("\r\n");
    pushString(`--${boundary}--\r\n`);

    const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bodyBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: bodyBytes.buffer,
    };
  }

  async transcribeWithMacOsSpeech(audioPath, language) {
    if (!Platform.isMacOS) {
      throw new Error("macOS 로컬 STT는 macOS 데스크톱 환경에서만 사용할 수 있습니다.");
    }

    return this.transcribeWithMacOsSpeechAbsolutePath(
      this.getVaultAbsolutePath(audioPath),
      language
    );
  }

  async transcribeWithMacOsSpeechAbsolutePath(absoluteAudioPath, language) {
    const { execFile } = require("child_process");
    const scriptPath = this.getPluginScriptPath("scripts/macos-transcribe.js");
    const locale = this.resolveMacLocale(language);

    const transcriptText = await new Promise((resolve, reject) => {
      execFile(
        "osascript",
        ["-l", "JavaScript", scriptPath, absoluteAudioPath, locale],
        { maxBuffer: 20 * 1024 * 1024 },
        (error, standardOutput, standardError) => {
          if (error) {
            const detail = standardError?.trim() || error.message || "알 수 없는 오류";
            if (isSpeechPermissionError(detail)) {
              reject(
                createTaggedError(
                  "speech-permission",
                  "macOS 'Speech Recognition' 권한이 필요합니다. 시스템 설정 > 개인정보 보호 및 보안 > Speech Recognition에서 허용하세요.",
                  error
                )
              );
              return;
            }

            if (isNoSpeechError(detail)) {
              reject(
                createTaggedError(
                  "no-speech",
                  "음성이 감지되지 않았습니다.",
                  error
                )
              );
              return;
            }

            reject(new Error(`macOS Speech 전사 실패: ${detail}`));
            return;
          }

          resolve((standardOutput || standardError || "").trim());
        }
      );
    });

    const transcript = String(transcriptText || "").trim();
    if (!transcript) {
      throw createTaggedError("no-speech", "음성이 감지되지 않았습니다.");
    }

    return transcript;
  }

  async transcribeWithWindowsSpeech({ audioBlob, audioPath, language, previewTranscript }) {
    if (!Platform.isWin) {
      throw new Error("Windows Speech provider는 Windows 데스크톱 환경에서만 사용할 수 있습니다.");
    }

    const normalizedPreview = this.normalizeText(previewTranscript);
    if (normalizedPreview) {
      return normalizedPreview;
    }

    if (this.getOpenAiApiKey()) {
      return this.transcribeWithOpenAi(
        audioBlob,
        this.basename(audioPath),
        language
      );
    }

    throw new Error(
      "Windows Speech provider는 현재 실시간 전사 누적본을 최종 전사로 사용합니다. 실시간 전사가 비어 있으면 OpenAI STT를 함께 설정해 주세요."
    );
  }

  async translateTranscriptToKorean({ transcript, sourceLanguage }) {
    const unavailableReason = this.getAiUnavailableReason();
    if (unavailableReason) {
      throw new Error(unavailableReason);
    }

    const translated = await this.generateTextWithProvider({
      label: "번역 요청",
      systemPrompt: [
        "당신은 음성 메모 전사를 한국어로 옮기는 번역기다.",
        "의미, 고유명사, 숫자, 문맥을 유지하고 필요한 경우만 자연스럽게 다듬어라.",
        "설명 없이 번역문 본문만 반환한다.",
      ].join(" "),
      userPrompt: [
        `원문 언어: ${this.getLanguageLabel(sourceLanguage)}`,
        "",
        "다음 전사를 한국어로 번역해 주세요.",
        "",
        transcript.trim(),
      ].join("\n"),
      temperature: 0.1,
    });

    if (!translated) {
      throw new Error("번역 응답이 비어 있습니다.");
    }

    return translated;
  }

  async generateSummary({
    title,
    topic,
    sourceText,
    templateText,
    requestText,
    agendaText,
    agentInstruction,
    customAgentInstruction,
  }) {
    const unavailableReason = this.getAiUnavailableReason();
    if (unavailableReason) {
      throw new Error(unavailableReason);
    }

    const summary = await this.generateTextWithProvider({
      label: "요약 요청",
      systemPrompt: [
        "당신은 회의 음성 메모와 초안 문서를 정리하는 한국어 회의록 도우미다.",
        "제공된 템플릿 구조를 최대한 유지하고, 원문에 없는 사실은 추측하지 마라.",
        "사전 메모와 안건은 회의 맥락으로만 사용하고, 전사에 없는 결론을 만들어내지 마라.",
        "출력은 마크다운 본문만 반환한다.",
      ].join(" "),
      userPrompt: this.buildSummaryPrompt({
        title,
        topic,
        sourceText,
        templateText,
        requestText,
        agendaText,
        agentInstruction,
        customAgentInstruction,
      }),
      temperature: 0.2,
    });

    if (!summary) {
      throw new Error("요약 응답이 비어 있습니다.");
    }

    return summary;
  }

  canUseAiSummary() {
    return !this.getAiUnavailableReason();
  }

  buildSummaryFallbackDraft({ templateText, requestText }) {
    const normalizedTemplate = this.normalizeText(templateText);
    const normalizedRequest = this.normalizeText(requestText);
    const guidanceBlock = [
      "> 자동 요약을 생성하지 않았습니다.",
      `> 이유: ${this.getAiUnavailableReason() || "AI Provider 설정이 완료되지 않았습니다."}`,
      "> 아래 음성 메모 전사 블록을 참고해 이 섹션을 이어서 정리하세요.",
    ].join("\n");

    if (normalizedTemplate) {
      return [
        guidanceBlock,
        "",
        "## 템플릿 초안",
        "",
        normalizedTemplate,
      ].join("\n");
    }

    return [
      guidanceBlock,
      "",
      "## 요청사항",
      "",
      normalizedRequest ||
        "핵심 내용, 결정사항, 실행 항목이 드러나게 간결한 마크다운 노트로 정리합니다.",
      "",
      "## 정리 초안",
      "",
      "- 핵심 내용",
      "- 결정사항",
      "- 실행 항목",
    ].join("\n");
  }

  buildSummaryPrompt({
    title,
    topic,
    sourceText,
    templateText,
    requestText,
    agendaText,
    agentInstruction,
    customAgentInstruction,
  }) {
    const normalizedTemplate = this.normalizeText(templateText);
    const normalizedRequest = this.normalizeText(requestText);
    const normalizedAgenda = this.normalizeText(agendaText);
    const agentPrompt = this.getAgentInstructionPrompt(
      agentInstruction,
      customAgentInstruction
    );

    if (normalizedTemplate) {
      return [
        "아래 메모/전사 내용을 템플릿에 맞춰 한국어로 정리해 주세요.",
        "",
        `제목: ${title || "미입력"}`,
        `주제: ${topic || "미입력"}`,
        `요약 에이전트 지침: ${this.getAgentInstructionLabel(agentInstruction)}`,
        agentPrompt ? `세부 지침: ${agentPrompt}` : null,
        normalizedAgenda ? "" : null,
        normalizedAgenda ? "사전 메모/안건:" : null,
        normalizedAgenda || null,
        "",
        "템플릿:",
        normalizedTemplate,
        normalizedRequest ? "" : null,
        normalizedRequest ? "추가 요청사항:" : null,
        normalizedRequest || null,
        "",
        "요약 규칙:",
        "- 템플릿에 YAML frontmatter/속성 블록이 있으면 문서 최상단에 유지합니다.",
        "- 템플릿 본문은 노트의 메인 내용이 되도록 바로 작성합니다.",
        "- 템플릿의 섹션 구조를 최대한 유지합니다.",
        "- 원문에서 확인되는 사실만 반영합니다.",
        "- 실행 항목은 가능하면 체크리스트로 정리합니다.",
        "- 담당자나 기한이 명확하지 않으면 임의로 만들지 말고 '미정'으로 표시합니다.",
        "- 불필요한 서론이나 설명을 추가하지 않습니다.",
        "",
        "정리 대상 본문:",
        sourceText.trim(),
      ]
        .filter((line) => line !== null)
        .join("\n");
    }

    return [
      "아래 메모/전사 내용을 요청사항에 맞춰 한국어로 정리해 주세요.",
      "",
      `제목: ${title || "미입력"}`,
      `주제: ${topic || "미입력"}`,
      `요약 에이전트 지침: ${this.getAgentInstructionLabel(agentInstruction)}`,
      agentPrompt ? `세부 지침: ${agentPrompt}` : null,
      normalizedAgenda ? "" : null,
      normalizedAgenda ? "사전 메모/안건:" : null,
      normalizedAgenda || null,
      "",
      "요청사항:",
      normalizedRequest || "핵심 내용, 결정사항, 실행 항목이 드러나게 간결한 마크다운 노트로 정리합니다.",
      "",
      "요약 규칙:",
      "- frontmatter/속성 블록이 있으면 문서 최상단에 유지합니다.",
      "- 결과는 노트의 메인 내용으로 바로 사용할 수 있게 작성합니다.",
      "- 원문에서 확인되는 사실만 반영합니다.",
      "- 담당자나 기한이 명확하지 않으면 임의로 만들지 말고 '미정'으로 표시합니다.",
      "- 불필요한 서론 없이 바로 결과를 작성합니다.",
      "- 실행 항목이 있으면 체크리스트로 정리합니다.",
      "",
      "정리 대상 본문:",
      sourceText.trim(),
    ]
      .filter((line) => line !== null)
      .join("\n");
  }

  getAgentInstructionPrompt(agentInstruction, customAgentInstruction) {
    const normalized = normalizeAgentInstruction(agentInstruction);
    if (normalized === "custom") {
      return this.normalizeText(customAgentInstruction);
    }
    return AGENT_INSTRUCTION_MAP[normalized]?.prompt || AGENT_INSTRUCTION_MAP.meeting.prompt;
  }

  async getTemplatesFolderPath() {
    const configPath = normalizePath(`${this.app.vault.configDir}/templates.json`);

    try {
      const exists = await this.app.vault.adapter.exists(configPath);
      if (!exists) {
        return "";
      }

      const raw = await this.app.vault.adapter.read(configPath);
      const data = JSON.parse(raw);
      return normalizePath(data?.folder || "");
    } catch (error) {
      console.error("Voice Workflow: templates.json을 읽지 못했습니다.", error);
      return "";
    }
  }

  async listTemplateFiles() {
    const folderPath = await this.getTemplatesFolderPath();
    if (!folderPath) {
      return [];
    }

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder || !Array.isArray(folder.children)) {
      return [];
    }

    const results = [];
    const stack = [folder];

    while (stack.length > 0) {
      const current = stack.pop();
      for (const child of current.children || []) {
        if (child instanceof TFile && child.extension === "md") {
          if (/\.bak\./i.test(child.name)) {
            continue;
          }

          results.push({
            path: child.path,
            name: child.basename,
          });
          continue;
        }

        if (Array.isArray(child.children)) {
          stack.push(child);
        }
      }
    }

    return results.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readVaultFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`파일을 찾지 못했습니다: ${path}`);
    }

    return this.app.vault.cachedRead(file);
  }

  listMarkdownFiles(query) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const cached = this.markdownFileCache;
    if (cached && cached.query === normalizedQuery) {
      return cached.files;
    }

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (!normalizedQuery) {
          return true;
        }

        return file.path.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 200);

    this.markdownFileCache = {
      query: normalizedQuery,
      files,
    };
    return files;
  }

  async loadWorkspaceFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`선택 파일을 찾지 못했습니다: ${path}`);
    }

    const content = await this.app.vault.cachedRead(file);
    const title =
      this.extractFirstHeading(content) ||
      file.basename ||
      this.basename(path).replace(/\.md$/i, "");
    const topic = this.extractFrontmatterValue(content, "topic");
    const sourceText = this.buildSourceTextFromContent(content);
    const summaryText = this.normalizeSummaryDraft(
      this.extractMarkdownSection(content, SUMMARY_HEADING)
    );

    return {
      file,
      title,
      topic,
      sourceText,
      summaryText,
    };
  }

  async saveSummaryToFile(path, summaryText) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`선택 파일을 찾지 못했습니다: ${path}`);
    }

    const content = await this.app.vault.cachedRead(file);
    const updatedContent = this.buildPrimarySummaryContent(content, summaryText);
    await this.writeNoteContent(file, updatedContent);
    return file;
  }

  buildSourceTextFromContent(content) {
    const bodyWithoutArchive = this.removeMarkdownSection(
      this.stripFrontmatter(this.removeLegacyRecordingSections(content)),
      RECORDING_ARCHIVE_HEADING
    );
    const bodyWithoutSummary = this.removeMarkdownSection(
      bodyWithoutArchive,
      SUMMARY_HEADING
    );
    return bodyWithoutSummary.trim();
  }

  normalizeSummaryDraft(summaryText) {
    const normalized = this.normalizeText(summaryText);
    if (!normalized || normalized === SUMMARY_PLACEHOLDER) {
      return "";
    }
    return normalized;
  }

  buildNoteContent({
    title,
    createdAt,
    topic,
    audioPath,
    sourceLanguage,
    transcript,
    translatedTranscript,
    summary,
  }) {
    const safeTopic = this.inlineValue(topic);
    const normalizedTranscript = this.normalizeText(transcript);
    const normalizedTranslatedTranscript = this.normalizeText(translatedTranscript);
    const normalizedSummary = this.normalizeText(summary);
    const frontmatter = [
      "---",
      `created: ${createdAt.toISOString()}`,
      `topic: "${this.escapeYamlValue(safeTopic || "미입력")}"`,
      `audio_file: "${this.escapeYamlValue(audioPath)}"`,
      `source_language: "${this.escapeYamlValue(
        this.getLanguageLabel(sourceLanguage)
      )}"`,
      `transcription_model: "${this.escapeYamlValue(
        this.getOpenAiTranscriptionModel()
      )}"`,
      `summary_model: "${this.escapeYamlValue(this.getActiveAiModel())}"`,
      `ai_provider: "${this.escapeYamlValue(this.getAiProviderLabel(this.getActiveAiProvider()))}"`,
      "---",
    ].join("\n");
    const archiveSection = this.upsertMarkdownSection(
      "",
      RECORDING_ARCHIVE_HEADING,
      this.buildRecordingArchiveEntry({
        createdAt,
        topic,
        audioPath,
        sourceLanguage,
        transcript: normalizedTranscript,
        translatedTranscript: normalizedTranslatedTranscript,
      })
    ).trim();

    return [
      frontmatter,
      "",
      `# ${title}`,
      "",
      normalizedSummary || SUMMARY_PLACEHOLDER,
      "",
      archiveSection,
      "",
    ].join("\n");
  }

  buildRecordingArchiveEntry({
    createdAt,
    topic,
    audioPath,
    sourceLanguage,
    transcript,
    translatedTranscript,
  }) {
    const normalizedAudioPath = this.inlineValue(audioPath);
    const normalizedTranscript =
      this.normalizeText(transcript) || "_전사 내용이 없습니다._";
    const normalizedTranslatedTranscript = this.normalizeText(translatedTranscript);
    const lines = [
      `### ${this.formatTimestamp(createdAt)} 기록`,
      "",
      `- 생성 시각: ${this.formatTimestamp(createdAt)}`,
      `- 주제: ${this.inlineValue(topic) || "미입력"}`,
      `- 언어: ${this.getLanguageLabel(sourceLanguage)}`,
      "",
      `**음성 파일**`,
      "",
      normalizedAudioPath ? `![[${normalizedAudioPath}]]` : "_음성 파일이 없습니다._",
      normalizedAudioPath ? `경로: [[${normalizedAudioPath}]]` : "",
      "",
      `**${TRANSCRIPT_HEADING}**`,
      "",
      normalizedTranscript,
    ];

    if (normalizedTranslatedTranscript) {
      lines.push(
        "",
        `**${TRANSLATED_TRANSCRIPT_HEADING}**`,
        "",
        normalizedTranslatedTranscript
      );
    }

    return lines.join("\n");
  }

  buildFoldedCallout(title, bodyLines) {
    const lines = [`> [!note]+ ${title}`];

    for (const bodyLine of bodyLines) {
      const normalizedLine = String(bodyLine || "");
      if (!normalizedLine) {
        lines.push(">");
        continue;
      }

      for (const innerLine of normalizedLine.split("\n")) {
        lines.push(`> ${innerLine}`);
      }
    }

    return lines.join("\n");
  }

  normalizeArchiveMarkup(archiveText) {
    const normalized = this.normalizeText(archiveText);
    if (!normalized) {
      return "";
    }
    return normalized
      .replace(/<details>\s*/g, "")
      .replace(/<\/details>/g, "")
      .replace(/^<summary>(.*?)<\/summary>\s*$/gm, "### $1")
      .replace(/^>\s*\[!note\][+-]?\s*(.+)$/gm, "### $1")
      .replace(/^>\s?/gm, "")
      .replace(/^####\s+음성 파일$/gm, "**음성 파일**")
      .replace(/^####\s+원문 전사$/gm, `**${TRANSCRIPT_HEADING}**`)
      .replace(
        /^####\s+번역 전사 \(한국어\)$/gm,
        `**${TRANSLATED_TRANSCRIPT_HEADING}**`
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async ensureFolder(folderPath) {
    const normalizedFolder = normalizePath(folderPath || "").trim();
    if (!normalizedFolder) {
      return;
    }

    const parts = normalizedFolder.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async getAvailablePath(folderPath, baseName, extension) {
    const normalizedFolder = normalizePath(folderPath);
    const safeBaseName = this.sanitizeFileName(baseName) || "voice-note";
    let candidate = normalizePath(`${normalizedFolder}/${safeBaseName}${extension}`);
    let counter = 2;

    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(
        `${normalizedFolder}/${safeBaseName} ${counter}${extension}`
      );
      counter += 1;
    }

    return candidate;
  }

  async writeBinaryFile(path, blob) {
    const data = await blob.arrayBuffer();
    await this.app.vault.createBinary(path, data);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`오디오 파일을 확인할 수 없습니다: ${path}`);
    }

    return file;
  }

  async parseRequestUrlResponse(response, label) {
    const rawText = response?.text || "";
    let data = {};

    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (error) {
        if (response.status >= 400) {
          throw new Error(`${label} 실패: ${rawText}`);
        }
        throw new Error(`${label} 응답을 JSON으로 해석하지 못했습니다.`);
      }
    }

    if (response.status >= 400) {
      const apiMessage =
        data?.error?.message ||
        data?.error?.details ||
        data?.message ||
        rawText ||
        `HTTP ${response.status}`;
      throw new Error(`${label} 실패: ${apiMessage}`);
    }

    return data;
  }

  buildOpenAiApiUrl(endpoint) {
    const baseUrl = this.getOpenAiApiBaseUrl().replace(/\/+$/, "");
    return `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  }

  buildAnthropicApiUrl(endpoint) {
    const baseUrl = String(this.settings.anthropicApiBaseUrl || "").trim().replace(/\/+$/, "");
    return `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  }

  buildGeminiGenerateContentUrl(model) {
    const baseUrl = String(this.settings.geminiApiBaseUrl || "").trim().replace(/\/+$/, "");
    return `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  }

  buildOllamaApiUrl(endpoint) {
    const baseUrl = this.getOllamaApiBaseUrl().replace(/\/+$/, "");
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    if (baseUrl.endsWith("/api") && normalizedEndpoint.startsWith("/api/")) {
      return `${baseUrl}${normalizedEndpoint.slice(4)}`;
    }
    return `${baseUrl}${normalizedEndpoint}`;
  }

  async postJsonRequest(url, { label, headers, body }) {
    const response = await requestUrl({
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    });
    return this.parseRequestUrlResponse(response, label);
  }

  getPluginScriptPath(relativePath) {
    const path = require("path");
    const adapter = this.app.vault.adapter;

    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("현재 환경에서는 로컬 스크립트 경로를 찾을 수 없습니다.");
    }

    return path.join(
      adapter.getBasePath(),
      this.app.vault.configDir,
      "plugins",
      this.manifest.id,
      relativePath
    );
  }

  getVaultAbsolutePath(relativePath) {
    const path = require("path");
    const adapter = this.app.vault.adapter;

    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("현재 환경에서는 볼트 절대 경로를 계산할 수 없습니다.");
    }

    return path.join(adapter.getBasePath(), normalizePath(relativePath));
  }

  async requestMacOsSpeechAuthorization(language) {
    if (!Platform.isMacOS) {
      throw new Error("이 기능은 macOS 데스크톱 환경에서만 사용할 수 있습니다.");
    }

    const { execFile } = require("child_process");
    const scriptPath = this.getPluginScriptPath("scripts/macos-transcribe.js");
    const locale = this.resolveMacLocale(language);

    await new Promise((resolve, reject) => {
      execFile(
        "osascript",
        ["-l", "JavaScript", scriptPath, "--authorize-only", locale],
        { maxBuffer: 4 * 1024 * 1024 },
        (error, standardOutput, standardError) => {
          if (error) {
            const detail = standardError?.trim() || error.message || "알 수 없는 오류";
            if (isSpeechPermissionError(detail)) {
              reject(
                createTaggedError(
                  "speech-permission",
                  "macOS 'Speech Recognition' 권한이 아직 허용되지 않았습니다.",
                  error
                )
              );
              return;
            }

            reject(new Error(`Speech Recognition 권한 확인 실패: ${detail}`));
            return;
          }

          resolve((standardOutput || standardError || "").trim());
        }
      );
    });
  }

  async openMacPrivacySettings(target) {
    if (!Platform.isMacOS) {
      throw new Error("이 기능은 macOS 데스크톱 환경에서만 사용할 수 있습니다.");
    }

    const { execFile } = require("child_process");
    const settingsUrl =
      target === "microphone"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition";

    await new Promise((resolve, reject) => {
      execFile("open", [settingsUrl], (error) => {
        if (!error) {
          resolve();
          return;
        }

        execFile("open", ["-a", "System Settings"], (fallbackError) => {
          if (fallbackError) {
            reject(
              new Error(
                "시스템 설정을 열지 못했습니다. 직접 시스템 설정 > 개인정보 보호 및 보안으로 이동해 주세요."
              )
            );
            return;
          }
          resolve();
        });
      });
    });
  }

  extractMessageText(messageContent) {
    if (typeof messageContent === "string") {
      return messageContent;
    }

    if (Array.isArray(messageContent)) {
      return messageContent
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry.text === "string") {
            return entry.text;
          }
          return "";
        })
        .join("\n");
    }

    return "";
  }

  splitFrontmatter(content) {
    const normalized = String(content || "");
    const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
    if (!match) {
      return { frontmatter: "", body: normalized };
    }

    return {
      frontmatter: match[0].trim(),
      body: normalized.slice(match[0].length),
    };
  }

  parseSimpleFrontmatter(frontmatterBlock) {
    const normalized = String(frontmatterBlock || "").trim();
    if (!normalized.startsWith("---")) {
      return null;
    }

    const lines = normalized
      .replace(/^---\n?/, "")
      .replace(/\n?---$/, "")
      .split("\n");
    const entries = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const match = trimmed.match(/^([^:\s][^:]*):\s*(.*)$/);
      if (!match) {
        return null;
      }
      entries.push({
        key: match[1],
        value: match[2],
      });
    }

    return entries;
  }

  mergeFrontmatterBlocks(existingFrontmatter, incomingFrontmatter) {
    const normalizedExisting = String(existingFrontmatter || "").trim();
    const normalizedIncoming = String(incomingFrontmatter || "").trim();

    if (!normalizedIncoming) {
      return normalizedExisting;
    }
    if (!normalizedExisting) {
      return normalizedIncoming;
    }

    const existingEntries = this.parseSimpleFrontmatter(normalizedExisting);
    const incomingEntries = this.parseSimpleFrontmatter(normalizedIncoming);
    if (!existingEntries || !incomingEntries) {
      return normalizedIncoming || normalizedExisting;
    }

    const merged = [];
    const seen = new Set();

    for (const entry of existingEntries) {
      const override = incomingEntries.find((candidate) => candidate.key === entry.key);
      merged.push(override || entry);
      seen.add(entry.key);
    }

    for (const entry of incomingEntries) {
      if (!seen.has(entry.key)) {
        merged.push(entry);
      }
    }

    return ["---", ...merged.map((entry) => `${entry.key}: ${entry.value}`), "---"].join(
      "\n"
    );
  }

  buildMeetingMetadataEntries({
    title,
    topic,
    participants,
    agenda,
    recordingStartedAt,
    recordingEndedAt,
    durationSeconds,
    consentConfirmed,
    consentMethod,
    audioPath,
    sourceLanguage,
    transcript,
    agentInstruction,
  }) {
    const startedAt =
      recordingStartedAt instanceof Date ? recordingStartedAt : new Date();
    const endedAt = recordingEndedAt instanceof Date ? recordingEndedAt : startedAt;
    const participantList = Array.isArray(participants)
      ? participants
      : this.parseListInput(participants);

    return [
      this.frontmatterEntry("type", "voice-meeting-note"),
      this.frontmatterEntry("meeting_title", title || "미입력"),
      this.frontmatterEntry("meeting_date", startedAt.toISOString().slice(0, 10)),
      this.frontmatterEntry("meeting_source", "manual"),
      this.frontmatterEntry("participants", participantList),
      this.frontmatterEntry("agenda", this.inlineValue(agenda)),
      this.frontmatterEntry("topic", this.inlineValue(topic)),
      this.frontmatterEntry("recording_started_at", startedAt.toISOString()),
      this.frontmatterEntry("recording_ended_at", endedAt.toISOString()),
      this.frontmatterEntry("duration_seconds", Math.max(0, durationSeconds || 0)),
      this.frontmatterEntry("consent_confirmed", Boolean(consentConfirmed)),
      this.frontmatterEntry("consent_method", consentMethod || "manual"),
      this.frontmatterEntry(
        "stt_provider",
        this.getSttProviderLabel(this.getResolvedSttProvider())
      ),
      this.frontmatterEntry("stt_model", this.getResolvedSttModelLabel()),
      this.frontmatterEntry(
        "ai_provider",
        this.getAiProviderLabel(this.getActiveAiProvider())
      ),
      this.frontmatterEntry("summary_model", this.getActiveAiModel()),
      this.frontmatterEntry(
        "agent_instruction",
        normalizeAgentInstruction(agentInstruction)
      ),
      this.frontmatterEntry("audio_file", audioPath),
      this.frontmatterEntry(
        "transcript_language",
        this.getLanguageLabel(sourceLanguage)
      ),
      this.frontmatterEntry(
        "transcript_chars",
        this.normalizeText(transcript).length
      ),
    ];
  }

  parseListInput(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.inlineValue(item)).filter(Boolean);
    }
    return String(value || "")
      .split(/[,;\n]/)
      .map((item) => this.inlineValue(item))
      .filter(Boolean);
  }

  yamlInlineArray(items) {
    const normalizedItems = this.parseListInput(items);
    if (normalizedItems.length === 0) {
      return "[]";
    }
    return `[${normalizedItems.map((item) => this.yamlQuote(item)).join(", ")}]`;
  }

  frontmatterEntry(key, data) {
    return {
      key,
      data,
      value: this.toYamlLiteral(data),
    };
  }

  toYamlLiteral(value) {
    if (Array.isArray(value)) {
      return this.yamlInlineArray(value);
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return this.yamlQuote(value ?? "");
  }

  yamlQuote(value) {
    return `"${this.escapeYamlValue(value)}"`;
  }

  extractGeminiText(responseData) {
    const parts = responseData?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return "";
    }

    return parts
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }

  async generateTextWithProvider({ label, systemPrompt, userPrompt, temperature }) {
    const provider = this.getActiveAiProvider();
    const model = this.getActiveAiModel();
    const apiKey = this.getActiveAiApiKey();

    if (this.providerRequiresApiKey(provider) && !apiKey) {
      throw new Error(`${this.getAiProviderLabel(provider)} API Key가 설정되지 않았습니다.`);
    }
    if (!model) {
      throw new Error(`${this.getAiProviderLabel(provider)} 모델이 설정되지 않았습니다.`);
    }

    if (provider === "ollama") {
      const data = await this.postJsonRequest(this.buildOllamaApiUrl("/api/chat"), {
        label,
        headers: {
          "content-type": "application/json",
        },
        body: {
          model,
          stream: false,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          options: {
            temperature,
          },
        },
      });

      return this.extractMessageText(data?.message?.content || data?.response).trim();
    }

    if (provider === "anthropic") {
      const data = await this.postJsonRequest(this.buildAnthropicApiUrl("/messages"), {
        label,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: {
          model,
          max_tokens: 2048,
          temperature,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: userPrompt,
            },
          ],
        },
      });

      return this.extractMessageText(data?.content).trim();
    }

    if (provider === "gemini") {
      const data = await this.postJsonRequest(this.buildGeminiGenerateContentUrl(model), {
        label,
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body: {
          system_instruction: {
            parts: [
              {
                text: systemPrompt,
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: userPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature,
          },
        },
      });

      return this.extractGeminiText(data).trim();
    }

    const data = await this.postJsonRequest(this.buildOpenAiApiUrl("/chat/completions"), {
      label,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: {
        model,
        temperature,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      },
    });
    return this.extractMessageText(data?.choices?.[0]?.message?.content).trim();
  }

  stripFrontmatter(content) {
    return this.splitFrontmatter(content).body;
  }

  extractFrontmatterValue(content, key) {
    const normalized = String(content || "");
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) {
      return "";
    }

    const pattern = new RegExp(`^${this.escapeRegExp(key)}:\\s*(.+)$`, "m");
    const valueMatch = match[1].match(pattern);
    if (!valueMatch) {
      return "";
    }

    return valueMatch[1].trim().replace(/^"(.*)"$/, "$1");
  }

  extractFirstHeading(content) {
    const body = this.stripFrontmatter(content);
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "";
  }

  extractMarkdownSection(content, heading) {
    const body = this.stripFrontmatter(content);
    const pattern = new RegExp(
      `(?:^|\\n)##\\s+${this.escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
      "m"
    );
    const match = body.match(pattern);
    return match ? match[1].trim() : "";
  }

  extractTrailingSectionBody(content, heading) {
    const body = String(content || "");
    const pattern = new RegExp(
      `(?:^|\\n)##\\s+${this.escapeRegExp(heading)}\\s*\\n?`,
      "m"
    );
    const match = pattern.exec(body);
    if (!match) {
      return "";
    }

    return body.slice(match.index + match[0].length).trim();
  }

  removeMarkdownSection(content, heading) {
    const pattern = new RegExp(
      `\\n?##\\s+${this.escapeRegExp(heading)}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`,
      "m"
    );

    return String(content || "")
      .replace(pattern, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  removeTrailingSection(content, heading) {
    const body = String(content || "");
    const pattern = new RegExp(
      `(?:^|\\n)##\\s+${this.escapeRegExp(heading)}\\s*\\n?`,
      "m"
    );
    const match = pattern.exec(body);
    if (!match) {
      return body.trim();
    }

    return body.slice(0, match.index).trimEnd();
  }

  upsertMarkdownSection(content, heading, sectionBody) {
    const normalizedBody = this.normalizeText(sectionBody) || "_내용이 없습니다._";
    const replacement = `## ${heading}\n\n${normalizedBody}\n`;
    const pattern = new RegExp(
      `(^|\\n)##\\s+${this.escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
      "m"
    );

    if (pattern.test(content)) {
      return String(content).replace(
        pattern,
        (match, prefix) => `${prefix}## ${heading}\n\n${normalizedBody}\n`
      );
    }

    return `${String(content || "").trimEnd()}\n\n${replacement}`;
  }

  appendTrailingSection(content, heading, sectionBody) {
    const normalizedContent = String(content || "").trimEnd();
    const normalizedBody = this.normalizeText(sectionBody) || "_내용이 없습니다._";
    return [normalizedContent, `## ${heading}`, "", normalizedBody]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  removeLegacyRecordingSections(content) {
    let nextContent = String(content || "");
    for (const heading of [
      RECORDING_METADATA_HEADING,
      TRANSCRIPT_HEADING,
      TRANSLATED_TRANSCRIPT_HEADING,
    ]) {
      nextContent = this.removeMarkdownSection(nextContent, heading);
    }
    return nextContent;
  }

  buildPrimarySummaryContent(content, summaryText) {
    const normalizedSummary = this.normalizeText(summaryText) || SUMMARY_PLACEHOLDER;
    const cleanedContent = this.removeLegacyRecordingSections(content);
    const {
      frontmatter: existingFrontmatter,
      body: bodyWithArchive,
    } = this.splitFrontmatter(cleanedContent);
    const existingArchive = this.extractTrailingSectionBody(
      bodyWithArchive,
      RECORDING_ARCHIVE_HEADING
    );
    const withoutArchiveBody = this.removeTrailingSection(
      bodyWithArchive,
      RECORDING_ARCHIVE_HEADING
    );
    const withoutSummary = this.removeMarkdownSection(withoutArchiveBody, SUMMARY_HEADING);
    const existingBody = String(withoutSummary || "");
    const { frontmatter: summaryFrontmatter, body: summaryBodyRaw } =
      this.splitFrontmatter(normalizedSummary);
    const baseFrontmatter = summaryFrontmatter
      ? this.mergeFrontmatterBlocks(existingFrontmatter, summaryFrontmatter)
      : existingFrontmatter;
    const trimmedExistingBody = String(existingBody || "").trim();
    const firstHeading = trimmedExistingBody.match(/^#\s+.+$/m)?.[0] || "";
    const summaryBody = String(summaryBodyRaw || normalizedSummary).trim();
    const shouldReuseTitle = firstHeading && !summaryBody.startsWith("# ");

    const bodyParts = [
      shouldReuseTitle ? firstHeading : "",
      summaryBody,
      existingArchive
        ? [`## ${RECORDING_ARCHIVE_HEADING}`, "", existingArchive].join("\n")
        : "",
    ].filter(Boolean);

    return [
      baseFrontmatter ? `${baseFrontmatter}\n` : "",
      bodyParts.join("\n\n").trim(),
      "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  isPlaceholderText(value) {
    const normalized = this.normalizeText(value);
    return (
      !normalized ||
      normalized === SUMMARY_PLACEHOLDER ||
      /^_.*없습니다\._$/m.test(normalized)
    );
  }

  escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  sanitizeFileName(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/[\\/:*?"<>|#[\]^]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeText(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  inlineValue(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  escapeYamlValue(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  escapeHeaderValue(value) {
    return String(value || "").replace(/["\r\n]/g, "_");
  }

  basename(path) {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    return parts[parts.length - 1] || normalized;
  }

  formatFileTimestamp(date) {
    return [
      date.getFullYear(),
      this.pad(date.getMonth() + 1),
      this.pad(date.getDate()),
      "-",
      this.pad(date.getHours()),
      this.pad(date.getMinutes()),
      this.pad(date.getSeconds()),
    ].join("");
  }

  formatTimestamp(date) {
    const datePart = [
      date.getFullYear(),
      this.pad(date.getMonth() + 1),
      this.pad(date.getDate()),
    ].join("-");
    const timePart = [
      this.pad(date.getHours()),
      this.pad(date.getMinutes()),
      this.pad(date.getSeconds()),
    ].join(":");

    return `${datePart} ${timePart}`;
  }

  pad(value) {
    return String(value).padStart(2, "0");
  }
};

class VoiceSummarySidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.recordedBuffers = [];
    this.sampleRate = 44100;
    this.timerId = null;
    this.previewTimerId = null;
    this.recordingStartedAt = 0;
    this.recordedElapsedMs = 0;
    this.isBusy = false;
    this.isRecording = false;
    this.isPaused = false;
    this.previewBusy = false;
    this.previewProcessedBufferCount = 0;
    this.recognition = null;
    this.recognitionStopRequested = false;
    this.realtimeRecognitionDisabledForSession = false;
    this.liveFinalSegments = [];
    this.liveInterimTranscript = "";
    this.activeTranscriptChunk = "";
    this.previewRollingTranscript = "";
    this.transcriptChunkStartedElapsedMs = 0;
    this.transcriptChunkStartBufferIndex = 0;
    this.transcriptFeedItems = [];
    this.templateFiles = [];
    this.noteOptions = [];
    this.recordedAudioBlob = null;
    this.recordingCreatedAt = null;
    this.recordingSessionStartedAt = null;
    this.recordingSessionEndedAt = null;
    this.lastRecordingDurationMs = 0;
    this.state = {
      activeTab: "transcript",
      noteTitle: "",
      topic: "",
      participants: "",
      agenda: "",
      sourceLanguage: this.plugin.settings.sourceLanguage,
      translateToKorean: Boolean(this.plugin.settings.translateToKorean),
      agentInstruction: this.plugin.settings.defaultAgentInstruction,
      customAgentInstruction: this.plugin.settings.customAgentInstruction || "",
      consentConfirmed: false,
      consentMethod: "manual",
      selectedTemplatePath:
        this.plugin.settings.selectedTemplatePath || TEMPLATE_CUSTOM_VALUE,
      templateDraft:
        this.plugin.settings.customSummaryTemplate || DEFAULT_SUMMARY_TEMPLATE,
      requestDraft: "",
      noteMode: this.app.workspace.getActiveFile()?.path ? "current" : "new",
      noteSearchQuery: "",
      selectedFilePath: this.app.workspace.getActiveFile()?.path || "",
      newNoteTitle: "",
      sourceText: "",
      summaryDraft: "",
      translatedTranscript: "",
      finalTranscript: "",
      savedAudioPath: "",
      statusMessage: DEFAULT_STATUS_MESSAGE,
      statusIsError: false,
      statusActions: [],
      activeTemplateFolder: "",
      loadedTemplatePath: "",
    };
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return VIEW_NAME;
  }

  getIcon() {
    return "mic";
  }

  async onOpen() {
    await this.refreshData();
    await this.hydrateInitialFileState();
    this.buildLayout();
    this.syncUiFromState();
  }

  async onClose() {
    this.stopTimer();
    await this.stopSpeechRecognition();
    this.teardownRecorder();
    await this.closeAudioContext();
    this.releaseStream();
    this.contentEl.empty();
  }

  async refreshData() {
    this.state.activeTemplateFolder = await this.plugin.getTemplatesFolderPath();
    this.templateFiles = await this.plugin.listTemplateFiles();

    if (
      this.state.selectedTemplatePath !== TEMPLATE_CUSTOM_VALUE &&
      !this.templateFiles.some(
        (templateFile) => templateFile.path === this.state.selectedTemplatePath
      )
    ) {
      this.state.selectedTemplatePath =
        this.plugin.settings.selectedTemplatePath ||
        this.templateFiles[0]?.path ||
        TEMPLATE_CUSTOM_VALUE;
    }

    if (
      this.state.selectedTemplatePath !== TEMPLATE_CUSTOM_VALUE &&
      this.state.loadedTemplatePath !== this.state.selectedTemplatePath
    ) {
      try {
        this.state.templateDraft = await this.plugin.readVaultFile(
          this.state.selectedTemplatePath
        );
        this.state.loadedTemplatePath = this.state.selectedTemplatePath;
      } catch (error) {
        this.state.templateDraft =
          this.plugin.settings.customSummaryTemplate || DEFAULT_SUMMARY_TEMPLATE;
        this.state.loadedTemplatePath = "";
      }
    }

    this.refreshNoteOptions();
  }

  async hydrateInitialFileState() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      this.refreshNoteOptions();
      return;
    }

    this.state.selectedFilePath = activeFile.path;
    if (!this.state.noteTitle) {
      this.state.noteTitle = activeFile.basename || "";
    }
    if (!this.state.newNoteTitle) {
      this.state.newNoteTitle = activeFile.basename || "";
    }
    this.refreshNoteOptions();
  }

  buildLayout() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("voice-summary-view");

    const root = contentEl.createDiv({ cls: "voice-workflow-shell" });

    const header = root.createDiv({ cls: "voice-workflow-header" });
    const titleWrap = header.createDiv({ cls: "voice-workflow-header-copy" });
    titleWrap.createEl("h2", { text: "Voice Workflow" });
    titleWrap.createEl("p", {
      cls: "voice-workflow-header-text",
      text: "중앙 노트는 직접 작성하고, 우측에서는 음성 인식과 요약만 처리합니다.",
    });

    const tabBar = header.createDiv({ cls: "voice-workflow-tabs" });
    this.transcriptTabButton = tabBar.createEl("button", {
      text: "음성인식",
      cls: "voice-workflow-tab-button",
    });
    this.summaryTabButton = tabBar.createEl("button", {
      text: "요약",
      cls: "voice-workflow-tab-button",
    });
    this.transcriptTabButton.addEventListener("click", () => {
      this.setActiveTab("transcript");
    });
    this.summaryTabButton.addEventListener("click", () => {
      this.setActiveTab("summary");
    });

    this.statusEl = root.createDiv({ cls: "voice-workflow-status" });
    this.statusMessageEl = this.statusEl.createDiv({
      cls: "voice-workflow-status-message",
    });
    this.statusActionsEl = this.statusEl.createDiv({
      cls: "voice-workflow-status-actions",
    });

    const body = root.createDiv({ cls: "voice-workflow-body" });
    this.transcriptPanelEl = body.createDiv({
      cls: "voice-workflow-panel voice-workflow-panel-transcript",
    });
    this.summaryPanelEl = body.createDiv({
      cls: "voice-workflow-panel voice-workflow-panel-summary",
    });

    const transport = this.transcriptPanelEl.createDiv({
      cls: "voice-workflow-transport",
    });
    this.recordingStateEl = transport.createDiv({
      cls: "voice-workflow-transport-state",
      text: "대기",
    });
    this.timerEl = transport.createDiv({
      cls: "voice-workflow-transport-time",
      text: "00:00",
    });
    this.transportMetaEl = transport.createDiv({
      cls: "voice-workflow-transport-meta",
      text: "마이크 입력을 기다리는 중",
    });

    const track = this.transcriptPanelEl.createDiv({
      cls: "voice-workflow-track",
    });
    this.transportTrackFillEl = track.createDiv({
      cls: "voice-workflow-track-fill",
    });

    const consentSection = this.transcriptPanelEl.createDiv({
      cls: "voice-workflow-consent",
    });
    const consentToggle = consentSection.createDiv({
      cls: "voice-summary-toggle",
    });
    this.consentToggleEl = consentToggle.createEl("input");
    this.consentToggleEl.type = "checkbox";
    this.consentToggleEl.id = "voice-workflow-consent-toggle";
    const consentLabel = consentToggle.createEl("label", {
      text: "참여자 녹음/전사 동의 확인",
    });
    consentLabel.setAttr("for", "voice-workflow-consent-toggle");
    this.consentToggleEl.addEventListener("change", () => {
      this.state.consentConfirmed = this.consentToggleEl.checked;
      this.state.consentMethod = this.consentToggleEl.checked ? "manual" : "";
      this.updateButtonState();
    });
    this.copyConsentButtonEl = consentSection.createEl("button", {
      text: "동의문 복사",
      cls: "voice-workflow-inline-button",
    });
    this.copyConsentButtonEl.addEventListener("click", () => {
      void this.handleCopyConsentMessage();
    });

    const transcriptFeedHeader = this.transcriptPanelEl.createDiv({
      cls: "voice-workflow-section-header",
    });
    transcriptFeedHeader.createEl("h3", { text: "실시간 전사" });
    transcriptFeedHeader.createEl("span", {
      cls: "voice-workflow-section-caption",
      text: "현재 구간은 이어서 보이고, 약 50초마다 한 덩어리로 정리됩니다.",
    });

    this.transcriptFeedEl = this.transcriptPanelEl.createDiv({
      cls: "voice-workflow-feed",
    });
    this.transcriptEmptyEl = this.transcriptFeedEl.createDiv({
      cls: "voice-workflow-empty-state",
      text: "녹음을 시작하면 실시간 원문 전사가 여기에 표시됩니다.",
    });

    const summaryHeader = this.summaryPanelEl.createDiv({
      cls: "voice-workflow-section-header",
    });
    summaryHeader.createEl("h3", { text: "요약 워크플로우" });
    summaryHeader.createEl("span", {
      cls: "voice-workflow-section-caption",
      text: "템플릿 선택 후 저장 대상을 정합니다.",
    });

    this.fileInfoEl = this.summaryPanelEl.createDiv({
      cls: "voice-workflow-summary-meta",
    });

    const templateSection = this.summaryPanelEl.createDiv({
      cls: "voice-workflow-summary-section",
    });
    const templateHeader = templateSection.createDiv({
      cls: "voice-workflow-section-header",
    });
    templateHeader.createEl("h4", { text: "템플릿" });
    this.templateRefreshButton = templateHeader.createEl("button", {
      text: "새로고침",
      cls: "voice-workflow-inline-button",
    });
    this.templateRefreshButton.addEventListener("click", () => {
      void this.handleRefreshTemplates();
    });

    templateSection.createEl("p", {
      cls: "voice-workflow-help",
      text: this.state.activeTemplateFolder
        ? `Templates 폴더: ${this.state.activeTemplateFolder}`
        : "Templates 폴더가 없으면 요청사항 입력 방식으로 동작합니다.",
    });

    this.templateChipContainerEl = templateSection.createDiv({
      cls: "voice-workflow-chip-row",
    });
    this.templatePreviewEl = templateSection.createDiv({
      cls: "voice-workflow-template-preview",
    });

    this.requestFieldEl = this.createField(
      this.summaryPanelEl,
      "요청사항",
      "템플릿 없이 정리할 때 원하는 결과 형식을 직접 적습니다."
    );
    this.requestTextareaEl = this.requestFieldEl.createEl("textarea", {
      cls: "voice-summary-textarea voice-summary-template",
    });
    this.requestTextareaEl.placeholder =
      "예: 회의 결정사항, 액션 아이템, 리스크를 짧게 정리";
    this.requestTextareaEl.addEventListener("input", () => {
      this.state.requestDraft = this.requestTextareaEl.value;
      this.updateTemplatePreview();
    });

    const targetSection = this.summaryPanelEl.createDiv({
      cls: "voice-workflow-summary-section",
    });
    targetSection.createEl("h4", { text: "저장 대상" });
    this.noteModeChipContainerEl = targetSection.createDiv({
      cls: "voice-workflow-chip-row",
    });

    this.noteSearchFieldEl = this.createField(
      targetSection,
      "기존 노트 검색",
      "다른 노트에 붙일 때만 선택합니다."
    );
    this.noteSearchInputEl = this.noteSearchFieldEl.createEl("input");
    this.noteSearchInputEl.type = "text";
    this.noteSearchInputEl.placeholder = "노트 경로 검색";
    this.noteSearchInputEl.addEventListener("input", () => {
      this.state.noteSearchQuery = this.noteSearchInputEl.value;
      this.refreshNoteOptions();
      this.renderNoteOptions();
      this.updateFileInfo();
    });
    this.noteSelectEl = this.noteSearchFieldEl.createEl("select", {
      cls: "voice-summary-file-select",
    });
    this.noteSelectEl.size = 8;
    this.noteSelectEl.addEventListener("change", () => {
      this.state.selectedFilePath = this.noteSelectEl.value;
      this.updateFileInfo();
    });

    this.newNoteFieldEl = this.createField(
      targetSection,
      "신규 노트 제목",
      "신규 노트를 만들 때 사용할 제목입니다."
    );
    this.newNoteTitleInputEl = this.newNoteFieldEl.createEl("input");
    this.newNoteTitleInputEl.type = "text";
    this.newNoteTitleInputEl.placeholder = "예: 3월 21일 회의 정리";
    this.newNoteTitleInputEl.addEventListener("input", () => {
      this.state.newNoteTitle = this.newNoteTitleInputEl.value;
      this.updateFileInfo();
    });

    const detailsSection = this.summaryPanelEl.createEl("details", {
      cls: "voice-workflow-advanced",
    });
    detailsSection.createEl("summary", { text: "세부 옵션" });
    const detailsBody = detailsSection.createDiv({
      cls: "voice-workflow-advanced-body",
    });
    const participantsField = this.createField(
      detailsBody,
      "참여자",
      "쉼표로 구분해 입력하면 회의 메타데이터에 저장됩니다."
    );
    this.participantsInputEl = participantsField.createEl("input");
    this.participantsInputEl.type = "text";
    this.participantsInputEl.placeholder = "예: 홍길동, 김철수";
    this.participantsInputEl.addEventListener("input", () => {
      this.state.participants = this.participantsInputEl.value;
    });

    const agendaField = this.createField(
      detailsBody,
      "사전 메모/안건",
      "요약 생성 시 회의 맥락으로 참고하고 메타데이터에도 저장합니다."
    );
    this.agendaTextareaEl = agendaField.createEl("textarea", {
      cls: "voice-summary-textarea voice-summary-agenda",
    });
    this.agendaTextareaEl.placeholder = "예: 오늘은 출시 일정과 담당자 확정을 논의";
    this.agendaTextareaEl.rows = 4;
    this.agendaTextareaEl.addEventListener("input", () => {
      this.state.agenda = this.agendaTextareaEl.value;
    });

    const topicField = this.createField(
      detailsBody,
      "주제",
      "요약 문맥을 좁히고 싶을 때만 입력합니다."
    );
    this.topicInputEl = topicField.createEl("input");
    this.topicInputEl.type = "text";
    this.topicInputEl.placeholder = "예: 미팅 액션 아이템";
    this.topicInputEl.addEventListener("input", () => {
      this.state.topic = this.topicInputEl.value;
    });

    const agentField = this.createField(
      detailsBody,
      "요약 에이전트 지침",
      "회의 성격에 따라 요약 구조와 강조점을 바꿉니다."
    );
    this.agentInstructionSelectEl = agentField.createEl("select");
    for (const option of this.plugin.getAgentInstructionOptions()) {
      this.agentInstructionSelectEl.appendChild(new Option(option.label, option.value));
    }
    this.agentInstructionSelectEl.addEventListener("change", async () => {
      this.state.agentInstruction = this.agentInstructionSelectEl.value;
      this.plugin.settings.defaultAgentInstruction = this.state.agentInstruction;
      await this.plugin.saveSettings();
      this.syncPostProcessUi();
    });

    this.customAgentFieldEl = this.createField(
      detailsBody,
      "커스텀 에이전트 지침",
      "직접 만든 회의록 규칙을 저장해 재사용합니다."
    );
    this.customAgentTextareaEl = this.customAgentFieldEl.createEl("textarea", {
      cls: "voice-summary-textarea voice-summary-agent",
    });
    this.customAgentTextareaEl.placeholder =
      "예: 리스크와 의사결정 근거를 먼저 쓰고, 액션 아이템은 담당자/기한 기준 표로 정리";
    this.customAgentTextareaEl.rows = 5;
    this.customAgentTextareaEl.addEventListener("input", async () => {
      this.state.customAgentInstruction = this.customAgentTextareaEl.value;
      this.plugin.settings.customAgentInstruction =
        this.state.customAgentInstruction.trim();
      await this.plugin.saveSettings();
    });

    const translateField = this.createField(
      detailsBody,
      "번역",
      "외국어 전사를 한국어로 함께 저장할지 선택합니다."
    );
    const translateToggle = translateField.createDiv({
      cls: "voice-summary-toggle",
    });
    this.translateToggleEl = translateToggle.createEl("input");
    this.translateToggleEl.type = "checkbox";
    this.translateToggleEl.id = "voice-workflow-translate-toggle";
    const translateLabel = translateToggle.createEl("label", {
      text: "한국어 번역 저장",
    });
    translateLabel.setAttr("for", "voice-workflow-translate-toggle");
    this.translateToggleEl.addEventListener("change", async () => {
      this.state.translateToKorean = this.translateToggleEl.checked;
      this.plugin.settings.translateToKorean = this.state.translateToKorean;
      await this.plugin.saveSettings();
      this.syncTranslatedTranscriptVisibility();
    });

    const summaryFooter = this.summaryPanelEl.createDiv({
      cls: "voice-workflow-summary-footer",
    });
    this.summaryActionHintEl = summaryFooter.createDiv({
      cls: "voice-workflow-summary-hint",
      text: "녹음을 종료하면 전사를 정리한 뒤 요약 저장 버튼이 활성화됩니다.",
    });
    this.processRecordingButton = summaryFooter.createEl("button", {
      text: "현재 전사 요약 저장",
      cls: "mod-cta voice-workflow-primary-button",
    });
    this.processRecordingButton.addEventListener("click", () => {
      void this.handleProcessRecording();
    });

    const bottomBar = root.createDiv({ cls: "voice-workflow-bottombar" });
    const languageRow = bottomBar.createDiv({
      cls: "voice-workflow-bottom-row voice-workflow-bottom-row-language",
    });
    languageRow.createEl("span", {
      cls: "voice-workflow-bottom-label",
      text: "언어",
    });
    this.languageSelectEl = languageRow.createEl("select", {
      cls: "voice-workflow-language-select",
    });
    for (const option of this.plugin.getLanguageOptions()) {
      this.languageSelectEl.appendChild(new Option(option.label, option.value));
    }
    this.languageSelectEl.addEventListener("change", async () => {
      this.state.sourceLanguage = this.languageSelectEl.value;
      this.plugin.settings.sourceLanguage = this.state.sourceLanguage;
      await this.plugin.saveSettings();
      this.setStatus("언어 설정을 저장했습니다.");
    });

    const controlRow = bottomBar.createDiv({
      cls: "voice-workflow-bottom-row voice-workflow-bottom-row-controls",
    });
    controlRow.createEl("span", {
      cls: "voice-workflow-bottom-label",
      text: "녹음",
    });

    const recordControls = controlRow.createDiv({
      cls: "voice-workflow-recorder-controls",
    });
    this.startButton = recordControls.createEl("button", {
      text: "녹음 시작",
      cls: "mod-cta",
    });
    this.pauseButton = recordControls.createEl("button", { text: "일시정지" });
    this.stopButton = recordControls.createEl("button", { text: "녹음 종료" });
    this.startButton.addEventListener("click", () => {
      void this.handleStartRecording();
    });
    this.pauseButton.addEventListener("click", () => {
      void this.handleTogglePause();
    });
    this.stopButton.addEventListener("click", () => {
      void this.handleStopAndSaveMemo();
    });

    this.renderTemplateOptions();
    this.refreshNoteOptions();
    this.setActiveTab(this.state.activeTab || "transcript");
  }

  createField(parent, label, description) {
    const field = parent.createDiv({ cls: "voice-summary-field" });
    field.createEl("label", { cls: "voice-summary-label", text: label });
    if (description) {
      field.createEl("p", {
        cls: "voice-summary-field-description",
        text: description,
      });
    }
    return field;
  }

  syncUiFromState() {
    if (this.topicInputEl) {
      this.topicInputEl.value = this.state.topic || "";
    }
    if (this.participantsInputEl) {
      this.participantsInputEl.value = this.state.participants || "";
    }
    if (this.agendaTextareaEl) {
      this.agendaTextareaEl.value = this.state.agenda || "";
    }
    if (this.agentInstructionSelectEl) {
      this.agentInstructionSelectEl.value =
        this.state.agentInstruction || this.plugin.settings.defaultAgentInstruction;
    }
    if (this.customAgentTextareaEl) {
      this.customAgentTextareaEl.value = this.state.customAgentInstruction || "";
    }
    if (this.consentToggleEl) {
      this.consentToggleEl.checked = Boolean(this.state.consentConfirmed);
    }
    if (this.languageSelectEl) {
      this.languageSelectEl.value = this.state.sourceLanguage || "auto";
    }
    if (this.translateToggleEl) {
      this.translateToggleEl.checked = Boolean(this.state.translateToKorean);
    }
    if (this.requestTextareaEl) {
      this.requestTextareaEl.value = this.state.requestDraft || "";
    }
    if (this.noteSearchInputEl) {
      this.noteSearchInputEl.value = this.state.noteSearchQuery || "";
    }
    if (this.newNoteTitleInputEl) {
      this.newNoteTitleInputEl.value = this.state.newNoteTitle || "";
    }

    this.renderTemplateOptions();
    this.renderNoteModeChips();
    this.renderNoteOptions();
    this.updateStatusUi();
    this.updateTransportUi();
    this.updateTranscriptUi();
    this.updateButtonState();
    this.updateFileInfo();
    this.syncTranslatedTranscriptVisibility();
    this.syncPostProcessUi();
    this.setActiveTab(this.state.activeTab || "transcript");
  }

  updateStatusUi() {
    if (!this.statusEl) {
      return;
    }

    if (this.statusMessageEl) {
      this.statusMessageEl.setText(
        this.state.statusMessage || DEFAULT_STATUS_MESSAGE
      );
    }

    if (this.statusActionsEl) {
      this.statusActionsEl.empty();
      for (const action of this.state.statusActions || []) {
        const button = this.statusActionsEl.createEl("button", {
          text: action.label,
          cls: "voice-workflow-status-action",
        });
        button.addEventListener("click", () => {
          void this.handleStatusAction(action.id);
        });
      }
    }

    this.statusEl.toggleClass("is-error", Boolean(this.state.statusIsError));
    this.statusEl.toggleClass("is-muted", !this.state.statusIsError);
  }

  updateTransportUi() {
    const transportState = this.isRecording
      ? this.isPaused
        ? "일시정지"
        : "녹음 중"
      : this.recordedAudioBlob
        ? "전사 완료"
        : "대기";

    if (this.recordingStateEl) {
      this.recordingStateEl.setText(transportState);
      this.recordingStateEl.toggleClass("is-recording", this.isRecording && !this.isPaused);
      this.recordingStateEl.toggleClass("is-paused", this.isPaused);
      this.recordingStateEl.toggleClass("is-ready", !this.isRecording && Boolean(this.recordedAudioBlob));
    }

    if (this.transportMetaEl) {
      const activeFile = this.app.workspace.getActiveFile();
      this.transportMetaEl.setText(
        activeFile instanceof TFile && activeFile.extension === "md"
          ? `현재 노트: ${activeFile.path}`
          : "현재 열린 노트 없음"
      );
    }

    if (this.transportTrackFillEl) {
      const elapsedSeconds = Math.max(
        0,
        Math.floor(
          (this.recordedElapsedMs +
            (this.isRecording && !this.isPaused
              ? Date.now() - this.recordingStartedAt
              : 0)) /
            1000
        )
      );
      const width = this.isRecording || this.recordedAudioBlob
        ? `${Math.max(4, Math.min(100, ((elapsedSeconds % 60) / 60) * 100 || 4))}%`
        : "0%";
      this.transportTrackFillEl.style.width = width;
      this.transportTrackFillEl.toggleClass("is-animated", this.isRecording && !this.isPaused);
    }
  }

  updateTranscriptUi() {
    if (!this.transcriptFeedEl) {
      return;
    }

    const currentChunkTranscript = this.getActiveTranscriptChunkText();
    this.transcriptFeedEl.empty();

    if (this.transcriptFeedItems.length === 0 && !currentChunkTranscript) {
      this.transcriptFeedEl.createDiv({
        cls: "voice-workflow-empty-state",
        text: "녹음을 시작하면 실시간 원문 전사가 여기에 표시됩니다.",
      });
      return;
    }

    for (const item of this.transcriptFeedItems) {
      const row = this.transcriptFeedEl.createDiv({
        cls: "voice-workflow-feed-row",
      });
      row.createEl("span", {
        cls: "voice-workflow-feed-time",
        text: item.time,
      });
      row.createDiv({
        cls: "voice-workflow-feed-bubble",
        text: item.text,
      });
    }

    if (currentChunkTranscript) {
      const row = this.transcriptFeedEl.createDiv({
        cls: "voice-workflow-feed-row is-interim",
      });
      row.createEl("span", {
        cls: "voice-workflow-feed-time",
        text: this.isRecording ? "현재 구간" : "마지막 구간",
      });
      row.createDiv({
        cls: "voice-workflow-feed-bubble",
        text: currentChunkTranscript,
      });
    }

    this.scrollTranscriptFeedToEnd();
  }

  scrollTranscriptFeedToEnd() {
    if (!this.transcriptFeedEl) {
      return;
    }

    window.requestAnimationFrame(() => {
      this.transcriptFeedEl.scrollTop = this.transcriptFeedEl.scrollHeight;
    });
  }

  syncTranslatedTranscriptVisibility() {
    // Translation is now used during save-time and kept out of the main transcript feed.
  }

  setActiveTab(tab) {
    this.state.activeTab = tab;

    if (this.transcriptTabButton) {
      this.transcriptTabButton.toggleClass("is-active", tab === "transcript");
    }
    if (this.summaryTabButton) {
      this.summaryTabButton.toggleClass("is-active", tab === "summary");
    }
    if (this.transcriptPanelEl) {
      this.transcriptPanelEl.toggleClass("is-hidden", tab !== "transcript");
    }
    if (this.summaryPanelEl) {
      this.summaryPanelEl.toggleClass("is-hidden", tab !== "summary");
    }
  }

  setStatus(message, isError = false, actions = []) {
    this.state.statusMessage = message;
    this.state.statusIsError = isError;
    this.state.statusActions = Array.isArray(actions) ? actions : [];
    this.updateStatusUi();
  }

  buildSpeechPermissionActions() {
    return [
      { id: "request-speech-permission", label: "권한 다시 확인" },
      { id: "open-speech-settings", label: "Speech 설정 열기" },
      { id: "open-microphone-settings", label: "마이크 설정 열기" },
    ];
  }

  buildMicrophonePermissionActions() {
    return [
      { id: "open-microphone-settings", label: "마이크 설정 열기" },
      { id: "open-speech-settings", label: "Speech 설정 열기" },
    ];
  }

  async handleStatusAction(actionId) {
    try {
      if (actionId === "request-speech-permission") {
        await this.plugin.requestMacOsSpeechAuthorization(this.state.sourceLanguage);
        this.setStatus(
          "Speech Recognition 권한 확인 요청을 보냈습니다. 승인 후 다시 녹음을 시작해 보세요."
        );
        new Notice("Speech Recognition 권한 확인 요청을 보냈습니다.");
        return;
      }

      if (actionId === "open-speech-settings") {
        await this.plugin.openMacPrivacySettings("speech");
        this.setStatus(
          "시스템 설정을 열었습니다. 개인정보 보호 및 보안 > Speech Recognition에서 Obsidian 또는 osascript를 허용하세요.",
          false,
          this.buildSpeechPermissionActions()
        );
        return;
      }

      if (actionId === "open-microphone-settings") {
        await this.plugin.openMacPrivacySettings("microphone");
        this.setStatus(
          "시스템 설정을 열었습니다. 개인정보 보호 및 보안 > 마이크에서 Obsidian을 허용하세요.",
          false,
          this.buildMicrophonePermissionActions()
        );
      }
    } catch (error) {
      const actions = isSpeechPermissionError(error)
        ? this.buildSpeechPermissionActions()
        : this.state.statusActions;
      this.setStatus(
        getErrorText(error) || "권한 관련 작업을 처리하지 못했습니다.",
        true,
        actions
      );
    }
  }

  async handleCopyConsentMessage() {
    try {
      const message =
        this.plugin.normalizeText(this.plugin.settings.consentMessage) ||
        DEFAULT_CONSENT_MESSAGE;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
      } else {
        const { clipboard } = require("electron");
        clipboard.writeText(message);
      }
      this.setStatus("동의문을 클립보드에 복사했습니다.");
      new Notice("동의문을 복사했습니다.");
    } catch (error) {
      this.setStatus(
        `동의문을 복사하지 못했습니다: ${error.message || String(error)}`,
        true
      );
    }
  }

  setBusy(isBusy) {
    this.isBusy = isBusy;
    this.updateButtonState();
  }

  updateButtonState() {
    const hasTranscript = Boolean(
      this.plugin.normalizeText(this.state.finalTranscript || this.getLiveTranscript())
    );
    const canProcessRecording =
      !this.isBusy && Boolean(this.recordedAudioBlob) && hasTranscript;

    if (this.startButton) {
      this.startButton.disabled =
        this.isBusy ||
        this.isRecording ||
        (this.plugin.settings.requireConsentBeforeRecording &&
          !this.state.consentConfirmed);
    }
    if (this.pauseButton) {
      this.pauseButton.disabled = this.isBusy || !this.isRecording;
      this.pauseButton.setText(this.isPaused ? "재개" : "일시정지");
    }
    if (this.stopButton) {
      this.stopButton.disabled = this.isBusy || !this.isRecording;
    }
    if (this.templateRefreshButton) {
      this.templateRefreshButton.disabled = this.isBusy;
    }
    if (this.processRecordingButton) {
      this.processRecordingButton.disabled = !canProcessRecording;
      this.processRecordingButton.setText(
        this.isBusy
          ? "전사 정리 중..."
          : this.plugin.canUseAiSummary()
            ? "현재 전사 요약 저장"
            : "전사 초안 저장"
      );
    }

    this.updateSummaryActionUi(hasTranscript, canProcessRecording);
    this.updateTransportUi();
  }

  updateSummaryActionUi(hasTranscript, canProcessRecording) {
    if (!this.summaryActionHintEl) {
      return;
    }

    let message = "";
    let stateClass = "is-muted";

    if (this.isBusy && this.isRecording) {
      message =
        "녹음 중에는 아직 저장할 수 없어요. 녹음 종료 후 전사를 정리하면 요약 저장이 활성화됩니다.";
    } else if (this.isBusy) {
      message = "지금 전사와 오디오를 정리 중입니다. 완료되면 요약 저장 버튼이 활성화돼요.";
    } else if (this.isRecording) {
      message = "녹음을 종료하면 최종 전사를 정리한 뒤 요약 저장이 가능해요.";
    } else if (!this.recordedAudioBlob) {
      message = "녹음을 먼저 진행해 주세요. 종료 후 요약 저장이 가능해요.";
    } else if (!hasTranscript) {
      stateClass = "is-warning";
      message =
        "전사 준비 전입니다. 조금 더 길게 말하거나 권한 설정을 확인한 뒤 다시 녹음해 주세요.";
    } else if (canProcessRecording) {
      stateClass = "is-ready";
      message = this.plugin.canUseAiSummary()
        ? "전사가 준비됐습니다. 템플릿과 저장 대상을 확인한 뒤 요약 저장을 눌러주세요."
        : "전사가 준비됐습니다. AI 요약 없이 초안 저장을 진행할 수 있어요.";
    }

    this.summaryActionHintEl.setText(message);
    this.summaryActionHintEl.removeClass("is-ready");
    this.summaryActionHintEl.removeClass("is-warning");
    this.summaryActionHintEl.removeClass("is-muted");
    this.summaryActionHintEl.addClass(stateClass);
  }

  renderTemplateOptions() {
    if (
      this.state.selectedTemplatePath !== TEMPLATE_CUSTOM_VALUE &&
      !this.templateFiles.some(
        (templateFile) => templateFile.path === this.state.selectedTemplatePath
      )
    ) {
      this.state.selectedTemplatePath = TEMPLATE_CUSTOM_VALUE;
    }

    this.renderTemplateChips();
    this.updateTemplatePreview();
  }

  renderTemplateChips() {
    if (!this.templateChipContainerEl) {
      return;
    }

    this.templateChipContainerEl.empty();
    const options = [
      {
        value: TEMPLATE_CUSTOM_VALUE,
        label: "요청사항 입력",
      },
      ...this.templateFiles.map((templateFile) => ({
        value: templateFile.path,
        label: templateFile.name,
      })),
    ];

    for (const option of options) {
      const chip = this.templateChipContainerEl.createEl("button", {
        text: option.label,
        cls: "voice-workflow-chip",
      });
      chip.toggleClass(
        "is-active",
        (this.state.selectedTemplatePath || TEMPLATE_CUSTOM_VALUE) === option.value
      );
      chip.addEventListener("click", () => {
        void this.handleTemplateSelectionChange(option.value);
      });
    }
  }

  updateTemplatePreview() {
    if (!this.templatePreviewEl) {
      return;
    }

    if (this.state.selectedTemplatePath === TEMPLATE_CUSTOM_VALUE) {
      const requestPreview =
        this.plugin.normalizeText(this.state.requestDraft) ||
        "템플릿 대신 직접 요청사항을 입력해 요약 형식을 정합니다.";
      this.templatePreviewEl.setText(requestPreview);
      this.templatePreviewEl.toggleClass("is-placeholder", !this.plugin.normalizeText(this.state.requestDraft));
      return;
    }

    const templatePreview =
      this.plugin.normalizeText(this.state.templateDraft) || "템플릿 내용을 불러오는 중입니다.";
    this.templatePreviewEl.setText(templatePreview);
    this.templatePreviewEl.toggleClass("is-placeholder", false);
  }

  refreshNoteOptions() {
    this.noteOptions = this.plugin.listMarkdownFiles(this.state.noteSearchQuery);
    if (this.state.noteMode === "current") {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile && activeFile.extension === "md") {
        this.state.selectedFilePath = activeFile.path;
      }
    }

    if (
      this.state.selectedFilePath &&
      !this.noteOptions.some((file) => file.path === this.state.selectedFilePath)
    ) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile && activeFile.extension === "md") {
        this.state.selectedFilePath = activeFile.path;
      }
    }
  }

  renderNoteOptions() {
    if (!this.noteSelectEl) {
      return;
    }

    const options = [...this.noteOptions];
    if (
      this.state.selectedFilePath &&
      !options.some((file) => file.path === this.state.selectedFilePath)
    ) {
      options.unshift({
        path: this.state.selectedFilePath,
        name: this.plugin.basename(this.state.selectedFilePath).replace(/\.md$/i, ""),
      });
    }

    this.noteSelectEl.innerHTML = "";
    for (const note of options) {
      this.noteSelectEl.appendChild(new Option(note.path, note.path));
    }

    if (this.state.selectedFilePath) {
      this.noteSelectEl.value = this.state.selectedFilePath;
    }
  }

  renderNoteModeChips() {
    if (!this.noteModeChipContainerEl) {
      return;
    }

    this.noteModeChipContainerEl.empty();
    const options = [
      { value: "current", label: "현재 노트" },
      { value: "existing", label: "기존 노트" },
      { value: "new", label: "신규 노트" },
    ];

    for (const option of options) {
      const chip = this.noteModeChipContainerEl.createEl("button", {
        text: option.label,
        cls: "voice-workflow-chip",
      });
      chip.toggleClass("is-active", this.state.noteMode === option.value);
      chip.addEventListener("click", () => {
        this.state.noteMode = option.value;
        if (option.value === "current") {
          const activeFile = this.app.workspace.getActiveFile();
          if (activeFile instanceof TFile && activeFile.extension === "md") {
            this.state.selectedFilePath = activeFile.path;
          }
        }
        this.syncPostProcessUi();
        this.updateFileInfo();
        this.renderNoteModeChips();
      });
    }
  }

  syncPostProcessUi() {
    const hasRecording = Boolean(this.recordedAudioBlob);
    if (this.requestFieldEl) {
      this.requestFieldEl.toggleClass(
        "is-hidden",
        this.state.selectedTemplatePath !== TEMPLATE_CUSTOM_VALUE
      );
    }

    if (this.noteSearchFieldEl) {
      this.noteSearchFieldEl.toggleClass(
        "is-hidden",
        this.state.noteMode !== "existing"
      );
    }

    if (this.newNoteFieldEl) {
      this.newNoteFieldEl.toggleClass("is-hidden", this.state.noteMode !== "new");
    }
    if (this.customAgentFieldEl) {
      this.customAgentFieldEl.toggleClass(
        "is-hidden",
        this.state.agentInstruction !== "custom"
      );
    }

    const disableTargetInputs = this.isBusy || !hasRecording;
    if (this.requestTextareaEl) {
      this.requestTextareaEl.disabled = disableTargetInputs;
    }
    if (this.noteSearchInputEl) {
      this.noteSearchInputEl.disabled = disableTargetInputs;
    }
    if (this.noteSelectEl) {
      this.noteSelectEl.disabled = disableTargetInputs;
    }
    if (this.newNoteTitleInputEl) {
      this.newNoteTitleInputEl.disabled = disableTargetInputs;
    }
    if (this.participantsInputEl) {
      this.participantsInputEl.disabled = this.isBusy;
    }
    if (this.agendaTextareaEl) {
      this.agendaTextareaEl.disabled = this.isBusy;
    }
    if (this.agentInstructionSelectEl) {
      this.agentInstructionSelectEl.disabled = this.isBusy;
    }
    if (this.customAgentTextareaEl) {
      this.customAgentTextareaEl.disabled = this.isBusy;
    }
  }

  updateFileInfo() {
    if (!this.fileInfoEl) {
      return;
    }

    this.fileInfoEl.empty();
    if (!this.recordedAudioBlob) {
      this.fileInfoEl.setText("녹음 종료 후 요약 탭에서 템플릿과 저장 노트를 선택합니다.");
      return;
    }

    const providerLabel = this.plugin.getAiProviderLabel(this.plugin.getActiveAiProvider());
    const summaryModeText = this.plugin.canUseAiSummary()
      ? `${providerLabel}로 요약을 생성해 저장합니다.`
      : `${this.plugin.getAiUnavailableReason()} 템플릿/요청사항 기반 초안만 저장합니다.`;

    if (this.state.noteMode === "current") {
      const activeFile = this.app.workspace.getActiveFile();
      this.fileInfoEl.setText(
        activeFile instanceof TFile && activeFile.extension === "md"
          ? `현재 노트에 저장: ${activeFile.path}\n${summaryModeText}`
          : "현재 노트가 열려 있지 않습니다."
      );
      return;
    }

    if (this.state.noteMode === "new") {
      this.fileInfoEl.createEl("span", {
        text: `신규 노트 생성: ${
          this.state.newNoteTitle.trim() || "제목 미입력"
        }\n${summaryModeText}`,
      });
      return;
    }

    if (!this.state.selectedFilePath) {
      this.fileInfoEl.setText("저장할 기존 노트를 선택하세요.");
      return;
    }

    this.fileInfoEl.createEl("span", {
      text: `저장 대상 노트: ${this.state.selectedFilePath}\n${summaryModeText}`,
    });
  }

  formatFeedTimestamp(date = new Date()) {
    return [
      this.plugin.pad(date.getHours()),
      this.plugin.pad(date.getMinutes()),
      this.plugin.pad(date.getSeconds()),
    ].join(":");
  }

  appendLiveTranscriptSegment(transcript, date = new Date()) {
    const normalized = this.plugin.normalizeText(transcript);
    if (!normalized) {
      return;
    }

    this.activeTranscriptChunk = this.mergeTranscriptProgress(
      this.activeTranscriptChunk,
      normalized
    );
    this.previewRollingTranscript = this.activeTranscriptChunk;
    this.commitLiveTranscriptChunkIfNeeded(date);
    this.updateTranscriptUi();
  }

  replaceLiveTranscriptSegments(transcript, date = new Date()) {
    const normalized = this.plugin.normalizeText(transcript);
    this.resetLiveTranscriptChunkState(0, 0);
    this.liveFinalSegments = normalized ? [normalized] : [];
    this.transcriptFeedItems = normalized
      ? [
          {
            text: normalized,
            time: this.formatFeedTimestamp(date),
          },
        ]
      : [];
    this.liveInterimTranscript = "";
    this.updateTranscriptUi();
  }

  getCurrentRecordingElapsedMs() {
    return (
      this.recordedElapsedMs +
      (this.isRecording && !this.isPaused
        ? Math.max(0, Date.now() - this.recordingStartedAt)
        : 0)
    );
  }

  getActiveTranscriptChunkText() {
    const stableChunk = this.plugin.normalizeText(this.activeTranscriptChunk);
    const interimChunk = this.plugin.normalizeText(this.liveInterimTranscript);

    if (!stableChunk) {
      return interimChunk;
    }
    if (!interimChunk) {
      return stableChunk;
    }

    return this.mergeTranscriptProgress(stableChunk, interimChunk);
  }

  resetLiveTranscriptChunkState(startBufferIndex = 0, elapsedMs = 0) {
    this.activeTranscriptChunk = "";
    this.previewRollingTranscript = "";
    this.liveInterimTranscript = "";
    this.transcriptChunkStartBufferIndex = startBufferIndex;
    this.transcriptChunkStartedElapsedMs = elapsedMs;
  }

  commitLiveTranscriptChunk(date = new Date()) {
    const committedText =
      this.plugin.normalizeText(this.activeTranscriptChunk) ||
      this.plugin.normalizeText(this.getActiveTranscriptChunkText());
    if (!committedText) {
      return false;
    }

    this.liveFinalSegments.push(committedText);
    this.transcriptFeedItems.push({
      text: committedText,
      time: this.formatFeedTimestamp(date),
    });
    if (this.transcriptFeedItems.length > MAX_TRANSCRIPT_FEED_ITEMS) {
      this.transcriptFeedItems = this.transcriptFeedItems.slice(
        -MAX_TRANSCRIPT_FEED_ITEMS
      );
    }
    this.resetLiveTranscriptChunkState(
      this.recordedBuffers.length,
      this.getCurrentRecordingElapsedMs()
    );
    return true;
  }

  commitLiveTranscriptChunkIfNeeded(date = new Date()) {
    const currentChunkMs =
      this.getCurrentRecordingElapsedMs() - this.transcriptChunkStartedElapsedMs;
    if (currentChunkMs < LIVE_TRANSCRIPT_COMMIT_INTERVAL_MS) {
      return false;
    }

    return this.commitLiveTranscriptChunk(date);
  }

  mergeTranscriptProgress(previousTranscript, nextTranscript) {
    const previous = this.plugin.inlineValue(previousTranscript);
    const next = this.plugin.inlineValue(nextTranscript);

    if (!previous) {
      return next;
    }
    if (!next) {
      return previous;
    }
    if (previous === next || next.startsWith(previous)) {
      return next;
    }
    if (previous.endsWith(next)) {
      return previous;
    }

    const previousTokens = previous.split(/\s+/).filter(Boolean);
    const nextTokens = next.split(/\s+/).filter(Boolean);
    const maxTokenOverlap = Math.min(previousTokens.length, nextTokens.length);

    for (let size = maxTokenOverlap; size >= 2; size -= 1) {
      const previousTail = previousTokens.slice(-size).join(" ");
      const nextHead = nextTokens.slice(0, size).join(" ");
      if (previousTail === nextHead) {
        return [...previousTokens, ...nextTokens.slice(size)].join(" ");
      }
    }

    const maxCharOverlap = Math.min(previous.length, next.length);
    for (let size = maxCharOverlap; size >= 12; size -= 1) {
      if (previous.slice(-size) === next.slice(0, size)) {
        return `${previous}${next.slice(size)}`.trim();
      }
    }

    return `${previous} ${next}`.replace(/\s+/g, " ").trim();
  }

  updateRollingPreviewTranscript(transcript) {
    const normalized = this.plugin.normalizeText(transcript);
    if (!normalized) {
      return;
    }

    this.previewRollingTranscript = this.mergeTranscriptProgress(
      this.previewRollingTranscript,
      normalized
    );
    this.activeTranscriptChunk = this.previewRollingTranscript;
    this.liveInterimTranscript = "";
    this.updateTranscriptUi();
  }

  async handleTemplateSelectionChange(selectedValueArg) {
    const selectedValue =
      selectedValueArg ||
      this.state.selectedTemplatePath ||
      TEMPLATE_CUSTOM_VALUE;
    this.state.selectedTemplatePath = selectedValue;
    this.plugin.settings.selectedTemplatePath =
      selectedValue === TEMPLATE_CUSTOM_VALUE ? "" : selectedValue;

    if (selectedValue === TEMPLATE_CUSTOM_VALUE) {
      this.state.loadedTemplatePath = "";
      this.state.templateDraft = "";
      await this.plugin.saveSettings();
      this.syncUiFromState();
      return;
    }

    try {
      this.setStatus("템플릿 내용을 불러오는 중입니다...");
      this.state.templateDraft = await this.plugin.readVaultFile(selectedValue);
      this.state.loadedTemplatePath = selectedValue;
      await this.plugin.saveSettings();
      this.setStatus("템플릿을 적용했습니다.");
      this.syncUiFromState();
    } catch (error) {
      this.setStatus(
        `템플릿을 불러오지 못했습니다: ${error.message || String(error)}`,
        true
      );
    }
  }

  async handleRefreshTemplates() {
    try {
      this.setBusy(true);
      this.setStatus("템플릿 목록을 다시 읽고 있습니다...");
      await this.refreshData();
      this.renderTemplateOptions();
      this.syncUiFromState();
      this.setStatus("템플릿 목록을 새로고침했습니다.");
    } catch (error) {
      this.setStatus(
        `템플릿 목록을 새로고침하지 못했습니다: ${error.message || String(
          error
        )}`,
        true
      );
    } finally {
      this.setBusy(false);
    }
  }

  async handleStartRecording() {
    if (this.isBusy || this.isRecording) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      new Notice("이 환경에서는 마이크 녹음을 사용할 수 없습니다.");
      return;
    }

    if (
      this.plugin.settings.requireConsentBeforeRecording &&
      !this.state.consentConfirmed
    ) {
      this.setStatus("녹음을 시작하기 전에 참여자 동의 확인을 체크하세요.", true);
      return;
    }

    try {
      this.setBusy(true);
      this.setStatus("마이크와 실시간 전사를 시작합니다...");
      this.setActiveTab("transcript");
      this.clearLiveTranscript(false);
      this.recordedAudioBlob = null;
      this.recordingCreatedAt = null;
      this.recordingSessionStartedAt = null;
      this.recordingSessionEndedAt = null;
      this.lastRecordingDurationMs = 0;
      this.state.finalTranscript = "";
      this.state.savedAudioPath = "";
      this.state.translatedTranscript = "";
      this.realtimeRecognitionDisabledForSession = false;
      this.isPaused = false;
      this.recordedElapsedMs = 0;
      this.previewProcessedBufferCount = 0;
      this.previewBusy = false;
      this.resetLiveTranscriptChunkState(0, 0);
      this.syncUiFromState();

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext API를 사용할 수 없습니다.");
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContextClass();
      await this.audioContext.resume();

      this.recordedBuffers = [];
      this.sampleRate = this.audioContext.sampleRate;
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.processorNode = this.audioContext.createScriptProcessor(
        AUDIO_PROCESSOR_BUFFER_SIZE,
        1,
        1
      );
      this.processorNode.onaudioprocess = (event) => {
        if (!this.isRecording || this.isPaused) {
          return;
        }

        const channelData = event.inputBuffer.getChannelData(0);
        this.recordedBuffers.push(new Float32Array(channelData));
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      this.isRecording = true;
      this.recordingSessionStartedAt = new Date();
      this.startPreviewLoop();
      this.recordingStartedAt = Date.now();
      this.startTimer();
      const liveRecognitionStarted = await this.startSpeechRecognition();
      if (liveRecognitionStarted) {
        this.setStatus("녹음 중입니다. 실시간 원문 전사를 확인하면서 종료하세요.");
      } else {
        this.setStatus(
          "녹음 중입니다. 맥 로컬 STT 미리보기로 현재 구간 전사를 이어서 갱신하고, 약 50초마다 한 덩어리로 정리합니다."
        );
      }
    } catch (error) {
      const actions = isMicrophonePermissionError(error)
        ? this.buildMicrophonePermissionActions()
        : isSpeechPermissionError(error)
          ? this.buildSpeechPermissionActions()
          : [];
      await this.stopSpeechRecognition();
      this.teardownRecorder();
      await this.closeAudioContext();
      this.releaseStream();
      this.setStatus(
        `녹음을 시작하지 못했습니다: ${error.message || String(error)}`,
        true,
        actions
      );
      new Notice("녹음을 시작하지 못했습니다.");
    } finally {
      this.setBusy(false);
    }
  }

  async handleTogglePause() {
    if (this.isBusy || !this.isRecording) {
      return;
    }

    if (this.isPaused) {
      this.isPaused = false;
      this.recordingStartedAt = Date.now();
      this.startTimer();
      const liveRecognitionStarted = await this.startSpeechRecognition();
      this.setStatus(
        liveRecognitionStarted
          ? "녹음을 다시 시작했습니다."
          : "녹음을 다시 시작했습니다. 로컬 STT 미리보기로 현재 구간 전사를 계속 이어서 갱신합니다."
      );
      this.updateButtonState();
      return;
    }

    this.isPaused = true;
    this.recordedElapsedMs += Date.now() - this.recordingStartedAt;
    this.stopTimer(false);
    await this.stopSpeechRecognition();
    await this.maybeTranscribePreview(true);
    this.setStatus("녹음을 일시정지했습니다. 다시 누르면 이어서 녹음합니다.");
    this.updateButtonState();
  }

  async handleStopAndSaveMemo() {
    if (this.isBusy || !this.isRecording) {
      return;
    }

    try {
      this.setBusy(true);
      this.setStatus("녹음을 종료하고 최종 전사를 정리하는 중입니다...");
      const audioBlob = await this.stopRecording();
      const createdAt = new Date();

      this.recordedAudioBlob = audioBlob;
      this.recordingCreatedAt = createdAt;
      this.recordingSessionEndedAt = createdAt;
      await this.ensureRecordedAudioSaved(createdAt);

      const result = await this.finalizeStoppedRecording(audioBlob);

      this.state.finalTranscript = result.transcript || "";
      this.state.translatedTranscript = result.translatedTranscript || "";
      if (result.transcript) {
        this.replaceLiveTranscriptSegments(result.transcript, createdAt);
      }

      if (!this.state.newNoteTitle.trim()) {
        this.state.newNoteTitle =
          this.state.noteTitle.trim() || `음성 메모 ${this.plugin.formatTimestamp(createdAt)}`;
      }

      if (result.transcriptUnavailable) {
        this.setActiveTab("transcript");
        this.syncUiFromState();

        if (isSpeechPermissionError(result.transcriptError)) {
          this.setStatus(
            "macOS 'Speech Recognition' 권한이 없어 전사를 건너뛰었습니다. 오디오는 저장됐고, 권한 허용 후 다시 녹음하면 됩니다.",
            false,
            this.buildSpeechPermissionActions()
          );
          new Notice("Speech Recognition 권한이 없어 오디오만 저장했습니다.");
        } else {
          this.setStatus(
            "음성이 충분히 감지되지 않아 전사를 만들지 못했습니다. 오디오는 저장됐고, 조금 더 길게 다시 녹음하면 됩니다."
          );
          new Notice("전사는 비어 있지만 오디오는 저장했습니다.");
        }

        return;
      }

      this.setActiveTab("summary");
      this.syncUiFromState();

      if (result.translationError) {
        this.setStatus(
          `전사는 준비됐지만 번역은 실패했습니다: ${
            result.translationError.message || String(result.translationError)
          }. 템플릿과 노트를 선택해 요약 저장을 진행하세요.`,
          true
        );
      } else {
        this.setStatus(
          this.plugin.canUseAiSummary()
            ? "녹음이 끝났습니다. 템플릿 또는 요청사항과 저장할 노트를 선택한 뒤 요약 저장을 진행하세요."
            : `녹음이 끝났습니다. ${this.plugin.getAiUnavailableReason()} 템플릿 또는 요청사항 기반 초안 저장은 가능합니다.`
        );
      }
      new Notice("녹음 종료. 후속 정리 옵션을 선택하세요.");
    } catch (error) {
      this.setStatus(
        `처리 중 오류가 발생했습니다: ${error.message || String(error)}`,
        true
      );
      new Notice("음성 메모 처리에 실패했습니다.");
    } finally {
      this.setBusy(false);
      this.updateButtonState();
    }
  }

  handleClearCapture() {
    this.clearLiveTranscript(true);
    this.recordedAudioBlob = null;
    this.recordingCreatedAt = null;
    this.recordingSessionStartedAt = null;
    this.recordingSessionEndedAt = null;
    this.lastRecordingDurationMs = 0;
    this.state.finalTranscript = "";
    this.state.savedAudioPath = "";
    this.state.translatedTranscript = "";
    this.state.activeTab = "transcript";
    this.updateTranscriptUi();
    this.syncTranslatedTranscriptVisibility();
    this.syncPostProcessUi();
    this.setActiveTab("transcript");
    this.setStatus(DEFAULT_STATUS_MESSAGE);
  }

  async ensureRecordedAudioSaved(createdAt) {
    if (!this.recordedAudioBlob) {
      return "";
    }

    let audioPath = this.plugin.normalizeText(this.state.savedAudioPath);
    const existingAudioFile = audioPath
      ? this.app.vault.getAbstractFileByPath(audioPath)
      : null;
    if (existingAudioFile instanceof TFile) {
      return audioPath;
    }

    const activeFile = this.app.workspace.getActiveFile();
    const audioTitle =
      this.state.noteTitle.trim() ||
      this.state.newNoteTitle.trim() ||
      (activeFile instanceof TFile ? activeFile.basename : "") ||
      `음성 메모 ${this.plugin.formatTimestamp(createdAt)}`;

    await this.plugin.ensureFolder(this.plugin.settings.audioFolder);
    audioPath = await this.plugin.getAvailablePath(
      this.plugin.settings.audioFolder,
      `${this.plugin.formatFileTimestamp(createdAt)} ${this.plugin.sanitizeFileName(
        audioTitle
      )}`,
      ".wav"
    );
    await this.plugin.writeBinaryFile(audioPath, this.recordedAudioBlob);
    this.state.savedAudioPath = audioPath;
    return audioPath;
  }

  async finalizeStoppedRecording(audioBlob) {
    let transcriptError = null;
    let transcript = "";
    const liveTranscript = this.plugin.normalizeText(this.getLiveTranscript());
    const savedAudioPath = this.plugin.normalizeText(this.state.savedAudioPath);

    try {
      transcript = await this.plugin.transcribeAudio({
        audioBlob,
        audioPath: savedAudioPath,
        language: this.state.sourceLanguage,
        previewTranscript: liveTranscript,
      });
    } catch (error) {
      transcriptError = error;
      transcript = liveTranscript;
    }

    transcript = this.plugin.normalizeText(transcript || liveTranscript);
    if (!transcript) {
      if (isRecoverableSpeechError(transcriptError)) {
        return {
          transcript: "",
          translatedTranscript: "",
          translationError: null,
          transcriptError,
          transcriptUnavailable: true,
        };
      }

      throw transcriptError || new Error("최종 전사 결과가 비어 있습니다.");
    }

    let translatedTranscript = "";
    let translationError = null;

    if (
      this.state.translateToKorean &&
      normalizeLanguageKey(this.state.sourceLanguage) !== "ko"
    ) {
      try {
        translatedTranscript = await this.plugin.translateTranscriptToKorean({
          transcript,
          sourceLanguage: this.state.sourceLanguage,
        });
      } catch (error) {
        translationError = error;
      }
    }

    return {
      transcript,
      translatedTranscript,
      translationError,
      transcriptError,
      transcriptUnavailable: false,
    };
  }

  buildSummarySourceForTarget(content, transcript, translatedTranscript, agendaText) {
    const currentNoteBody = this.plugin
      .removeMarkdownSection(this.plugin.stripFrontmatter(content), SUMMARY_HEADING)
      .trim();
    const latestRecordingText =
      this.plugin.normalizeText(translatedTranscript) ||
      this.plugin.normalizeText(transcript);
    const normalizedAgenda = this.plugin.normalizeText(agendaText);

    return [
      normalizedAgenda ? "## 사전 메모/안건" : "",
      normalizedAgenda,
      currentNoteBody,
      "## 이번 녹음 전사",
      latestRecordingText,
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  async resolveTargetNoteFile(createdAt) {
    if (this.state.noteMode === "current") {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile && activeFile.extension === "md") {
        this.state.selectedFilePath = activeFile.path;
        return activeFile;
      }
      throw new Error("현재 저장할 노트가 열려 있지 않습니다.");
    }

    if (this.state.noteMode === "existing") {
      if (!this.state.selectedFilePath) {
        throw new Error("저장할 기존 노트를 선택하세요.");
      }

      const existingFile = this.app.vault.getAbstractFileByPath(
        this.state.selectedFilePath
      );
      if (!(existingFile instanceof TFile) || existingFile.extension !== "md") {
        throw new Error("선택한 기존 노트를 찾지 못했습니다.");
      }
      return existingFile;
    }

    const resolvedTitle =
      this.state.newNoteTitle.trim() ||
      this.state.noteTitle.trim() ||
      `음성 메모 ${this.plugin.formatTimestamp(createdAt)}`;

    await this.plugin.ensureFolder(this.plugin.settings.noteFolder);
    const notePath = await this.plugin.getAvailablePath(
      this.plugin.settings.noteFolder,
      `${this.plugin.formatFileTimestamp(createdAt)} ${this.plugin.sanitizeFileName(
        resolvedTitle
      )}`,
      ".md"
    );
    return this.app.vault.create(notePath, `# ${resolvedTitle}\n`);
  }

  async handleProcessRecording() {
    if (this.isBusy) {
      return;
    }

    if (!this.recordedAudioBlob) {
      this.setStatus("먼저 녹음을 종료해 전사를 준비하세요.", true);
      return;
    }

    const transcript = this.plugin.normalizeText(
      this.state.finalTranscript || this.getLiveTranscript()
    );
    if (!transcript) {
      this.setStatus("요약할 전사 내용이 없습니다.", true);
      return;
    }

    const useCustomRequest =
      this.state.selectedTemplatePath === TEMPLATE_CUSTOM_VALUE;
    const requestText = this.plugin.normalizeText(this.state.requestDraft);
    const templateText = useCustomRequest
      ? ""
      : this.plugin.normalizeText(this.state.templateDraft);

    if (useCustomRequest && !requestText) {
      this.setStatus("템플릿이 없으면 요청사항을 입력하세요.", true);
      return;
    }

    if (!useCustomRequest && !templateText) {
      this.setStatus("요약에 사용할 템플릿을 선택하세요.", true);
      return;
    }

    try {
      this.setBusy(true);
      this.setStatus(
        this.plugin.canUseAiSummary()
          ? "녹음 내용을 요약하고 노트에 저장하는 중입니다..."
          : "AI 요약 설정이 완료되지 않아 전사 초안을 노트에 저장하는 중입니다..."
      );

      const createdAt = this.recordingCreatedAt || new Date();
      const noteFile = await this.resolveTargetNoteFile(createdAt);
      const currentContent = await this.plugin.readNoteContent(noteFile);
      const noteTitle =
        this.plugin.extractFirstHeading(currentContent) ||
        noteFile.basename ||
        this.state.newNoteTitle.trim() ||
        this.state.noteTitle.trim() ||
        `음성 메모 ${this.plugin.formatTimestamp(createdAt)}`;

      await this.plugin.ensureFolder(this.plugin.settings.audioFolder);
      let audioPath = this.plugin.normalizeText(this.state.savedAudioPath);
      const existingAudioFile = audioPath
        ? this.app.vault.getAbstractFileByPath(audioPath)
        : null;
      if (!(existingAudioFile instanceof TFile)) {
        audioPath = await this.plugin.getAvailablePath(
          this.plugin.settings.audioFolder,
          `${this.plugin.formatFileTimestamp(createdAt)} ${this.plugin.sanitizeFileName(
            noteTitle
          )}`,
          ".wav"
        );
        await this.plugin.writeBinaryFile(audioPath, this.recordedAudioBlob);
      }
      this.state.savedAudioPath = audioPath;

      const metadataEntries = this.plugin.buildMeetingMetadataEntries({
        title: noteTitle,
        topic: this.state.topic.trim(),
        participants: this.state.participants,
        agenda: this.state.agenda,
        recordingStartedAt: this.recordingSessionStartedAt || createdAt,
        recordingEndedAt: this.recordingSessionEndedAt || createdAt,
        durationSeconds: Math.round((this.lastRecordingDurationMs || 0) / 1000),
        consentConfirmed: Boolean(this.state.consentConfirmed),
        consentMethod: this.state.consentMethod || "manual",
        audioPath,
        sourceLanguage: this.state.sourceLanguage,
        transcript,
        agentInstruction: this.state.agentInstruction,
      });

      const recordingContent = this.plugin.appendRecordingToNote(currentContent, {
        createdAt,
        topic: this.state.topic.trim(),
        audioPath,
        sourceLanguage: this.state.sourceLanguage,
        transcript,
        translatedTranscript: this.state.translatedTranscript,
      });

      const sourceText = this.buildSummarySourceForTarget(
        currentContent,
        transcript,
        this.state.translatedTranscript,
        this.state.agenda
      );

      const summary = this.plugin.canUseAiSummary()
        ? await this.plugin.generateSummary({
            title: noteTitle,
            topic: this.state.topic.trim(),
            sourceText,
            templateText,
            requestText,
            agendaText: this.state.agenda,
            agentInstruction: this.state.agentInstruction,
            customAgentInstruction: this.state.customAgentInstruction,
          })
        : this.plugin.buildSummaryFallbackDraft({
            templateText,
            requestText,
          });

      const finalContent = this.plugin.buildPrimarySummaryContent(
        recordingContent,
        summary
      );
      await this.plugin.writeNoteContent(noteFile, finalContent);
      await this.plugin.applyFrontmatterEntriesToFile(noteFile, metadataEntries);

      this.state.selectedFilePath = noteFile.path;
      this.refreshNoteOptions();
      this.renderNoteOptions();
      await this.app.workspace.getLeaf(true).openFile(noteFile);

      if (this.plugin.canUseAiSummary()) {
        this.setStatus("요약을 노트에 저장했습니다.");
        new Notice("녹음 요약을 노트에 저장했습니다.");
      } else {
        this.setStatus("AI 요약 없이 전사 초안을 노트에 저장했습니다.");
        new Notice("전사 초안을 노트에 저장했습니다.");
      }
    } catch (error) {
      this.setStatus(
        `요약 저장에 실패했습니다: ${error.message || String(error)}`,
        true
      );
      new Notice("녹음 요약 저장에 실패했습니다.");
    } finally {
      this.setBusy(false);
      this.syncUiFromState();
    }
  }

  clearLiveTranscript(resetDrafts) {
    this.liveFinalSegments = [];
    this.transcriptFeedItems = [];
    this.resetLiveTranscriptChunkState(0, 0);
    this.updateTranscriptUi();
  }

  getLiveTranscript() {
    return this.plugin.normalizeText(
      [this.liveFinalSegments.join("\n\n"), this.getActiveTranscriptChunkText()]
        .filter(Boolean)
        .join("\n")
    );
  }

  startPreviewLoop() {
    this.stopPreviewLoop();
    this.previewTimerId = window.setInterval(() => {
      void this.maybeTranscribePreview(false);
    }, PREVIEW_TRANSCRIPT_INTERVAL_MS);
  }

  stopPreviewLoop() {
    if (this.previewTimerId) {
      window.clearInterval(this.previewTimerId);
      this.previewTimerId = null;
    }
  }

  async maybeTranscribePreview(forceFlush) {
    if (this.previewBusy || (!this.isRecording && !forceFlush)) {
      return;
    }

    const hasWebSpeech =
      Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition);
    if (hasWebSpeech && !this.realtimeRecognitionDisabledForSession) {
      return;
    }

    const endIndex = this.recordedBuffers.length;
    const newBuffers = this.recordedBuffers.slice(this.previewProcessedBufferCount, endIndex);
    if (newBuffers.length === 0) {
      return;
    }

    const totalSamples = newBuffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const minimumSamples = forceFlush
      ? Math.floor(this.sampleRate * 0.4)
      : Math.floor(this.sampleRate * PREVIEW_TRANSCRIPT_MIN_SECONDS);

    if (totalSamples < minimumSamples) {
      return;
    }

    const previewBuffers = this.recordedBuffers.slice(
      this.transcriptChunkStartBufferIndex,
      endIndex
    );
    if (previewBuffers.length === 0) {
      return;
    }

    this.previewBusy = true;

    try {
      const previewBlob = this.buildWavBlobFromBuffers(previewBuffers);
      const transcript = await this.transcribePreviewChunk(previewBlob);
      if (transcript) {
        this.updateRollingPreviewTranscript(transcript);
        if (this.commitLiveTranscriptChunkIfNeeded()) {
          this.updateTranscriptUi();
        }
      }
      this.previewProcessedBufferCount = endIndex;
    } catch (error) {
      if (isRecoverableSpeechError(error)) {
        this.previewProcessedBufferCount = endIndex;

        if (isSpeechPermissionError(error)) {
          this.setStatus(
            "macOS 'Speech Recognition' 권한이 없어 실시간 전사를 건너뜁니다. 녹음은 계속됩니다.",
            false,
            this.buildSpeechPermissionActions()
          );
        }
        return;
      }

      console.error("Voice Workflow: preview transcription failed", error);
    } finally {
      this.previewBusy = false;
    }
  }

  async transcribePreviewChunk(audioBlob) {
    const provider = this.plugin.getResolvedSttProvider();
    const canUseMacPreview = Platform.isMacOS;

    if (provider === "macos-speech" && canUseMacPreview) {
      const { promises: fs } = require("fs");
      const os = require("os");
      const path = require("path");
      const tempPath = path.join(
        os.tmpdir(),
        `voice-workflow-preview-${Date.now()}.wav`
      );

      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        await fs.writeFile(tempPath, Buffer.from(arrayBuffer));
        return await this.plugin.transcribeWithMacOsSpeechAbsolutePath(
          tempPath,
          this.state.sourceLanguage
        );
      } finally {
        try {
          await fs.unlink(tempPath);
        } catch (error) {
          // noop
        }
      }
    }

    if (provider === "windows-speech" || provider === "macos-speech") {
      return "";
    }

    if (!this.plugin.getOpenAiApiKey()) {
      return "";
    }

    return this.plugin.transcribeWithOpenAi(
      audioBlob,
      `voice-workflow-preview-${Date.now()}.wav`,
      this.state.sourceLanguage
    );
  }

  disableLiveRecognition(reasonCode) {
    this.realtimeRecognitionDisabledForSession = true;
    this.recognitionStopRequested = true;

    try {
      this.recognition?.abort?.();
    } catch (error) {
      console.error("Voice Workflow: recognition abort failed", error);
    }

    this.recognition = null;
    this.liveInterimTranscript = "";
    this.updateTranscriptUi();

    const detail = reasonCode ? ` (${reasonCode})` : "";
    this.setStatus(
      `실시간 전사는 현재 환경에서 사용할 수 없어 저장 후 STT로 계속 진행합니다${detail}.`,
      false
    );
  }

  async startSpeechRecognition() {
    if (this.plugin.getResolvedSttProvider() === "macos-speech") {
      this.realtimeRecognitionDisabledForSession = true;
      return false;
    }

    const RecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!RecognitionClass) {
      this.realtimeRecognitionDisabledForSession = true;
      return false;
    }

    if (this.realtimeRecognitionDisabledForSession) {
      return false;
    }

    this.recognitionStopRequested = false;
    this.recognition = new RecognitionClass();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    const recognitionLanguage = this.plugin.resolveSpeechRecognitionLanguage(
      this.state.sourceLanguage
    );
    if (recognitionLanguage) {
      this.recognition.lang = recognitionLanguage;
    }

    this.recognition.onresult = (event) => {
      const interimParts = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = String(
          event.results[index]?.[0]?.transcript || ""
        ).trim();

        if (!transcript) {
          continue;
        }

        if (event.results[index].isFinal) {
          this.appendLiveTranscriptSegment(transcript);
        } else {
          interimParts.push(transcript);
        }
      }

      this.commitLiveTranscriptChunkIfNeeded();
      this.liveInterimTranscript = interimParts.join(" ");
      this.updateTranscriptUi();
    };

    this.recognition.onerror = (event) => {
      if (event?.error === "aborted" && this.recognitionStopRequested) {
        return;
      }

      if (event?.error === "no-speech") {
        this.setStatus(
          "음성이 아직 감지되지 않았습니다. 말하면 실시간 전사가 이어집니다."
        );
        return;
      }

      if (
        [
          "network",
          "service-not-allowed",
          "not-allowed",
          "audio-capture",
          "language-not-supported",
        ].includes(event?.error)
      ) {
        this.disableLiveRecognition(event.error);
        return;
      }

      const detail = event?.error || "알 수 없는 오류";
      this.setStatus(`실시간 전사 오류: ${detail}`, true);
    };

    // Chromium speech recognition stops periodically, so restart while recording.
    this.recognition.onend = () => {
      const shouldRestart =
        this.isRecording &&
        !this.recognitionStopRequested &&
        !this.realtimeRecognitionDisabledForSession;
      this.recognition = null;

      if (shouldRestart) {
        window.setTimeout(() => {
          void this.startSpeechRecognition();
        }, 250);
      }
    };

    try {
      this.recognition.start();
      return true;
    } catch (error) {
      this.recognition = null;
      this.realtimeRecognitionDisabledForSession = true;
      this.setStatus(
        `실시간 전사를 시작하지 못해 저장 후 STT 보정으로 전환합니다: ${
          error.message || String(error)
        }`,
        false
      );
      return false;
    }
  }

  async stopSpeechRecognition() {
    if (!this.recognition) {
      return;
    }

    this.recognitionStopRequested = true;

    try {
      this.recognition.stop();
    } catch (error) {
      console.error("Voice Workflow: recognition stop failed", error);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 150));
    this.recognition = null;
  }

  async stopRecording() {
    if (!this.isRecording) {
      throw new Error("종료할 녹음이 없습니다.");
    }

    this.isRecording = false;
    this.stopPreviewLoop();
    if (!this.isPaused) {
      this.recordedElapsedMs += Date.now() - this.recordingStartedAt;
    }
    this.lastRecordingDurationMs = this.recordedElapsedMs;
    this.stopTimer(false);
    await this.stopSpeechRecognition();
    await this.maybeTranscribePreview(true);
    const wavBlob = this.buildWavBlob();
    await this.closeAudioContext();
    this.teardownRecorder();
    this.releaseStream();
    return wavBlob;
  }

  startTimer() {
    this.stopTimer(false);
    this.updateTimer();
    this.timerId = window.setInterval(() => this.updateTimer(), 1000);
  }

  stopTimer(resetDisplay = true) {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    if (resetDisplay && this.timerEl) {
      this.timerEl.setText("00:00");
    }

    this.updateTransportUi();
  }

  updateTimer() {
    const elapsedSeconds = Math.max(
      0,
      Math.floor(
        (this.recordedElapsedMs +
          (this.isRecording && !this.isPaused
            ? Date.now() - this.recordingStartedAt
            : 0)) /
          1000
      )
    );
    const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    this.timerEl?.setText(`${minutes}:${seconds}`);
    this.updateTransportUi();
  }

  releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  teardownRecorder() {
    this.isRecording = false;
    this.isPaused = false;
    this.recordedElapsedMs = 0;
    this.previewProcessedBufferCount = 0;
    this.previewBusy = false;
    this.stopPreviewLoop();

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    this.recordedBuffers = [];
  }

  async closeAudioContext() {
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }

    this.audioContext = null;
  }

  buildWavBlob() {
    const merged = this.mergeBuffers(this.recordedBuffers);
    const wavBuffer = this.encodeWav(merged, this.sampleRate);
    return new Blob([wavBuffer], { type: "audio/wav" });
  }

  buildWavBlobFromBuffers(buffers) {
    const merged = this.mergeBuffers(buffers);
    const wavBuffer = this.encodeWav(merged, this.sampleRate);
    return new Blob([wavBuffer], { type: "audio/wav" });
  }

  mergeBuffers(buffers) {
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
      merged.set(buffer, offset);
      offset += buffer.length;
    }

    return merged;
  }

  encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const dataLength = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    this.writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    this.writeAscii(view, 8, "WAVE");
    this.writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    this.writeAscii(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }

    return buffer;
  }

  writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }
}

class VoiceSummaryWorkflowSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("voice-summary-setting");

    containerEl.createEl("h2", { text: "Voice Workflow 설정" });

    new Setting(containerEl)
      .setName("STT Provider")
      .setDesc("Auto는 macOS에서 로컬 Speech, Windows에서 실시간 Speech 누적본, 그 외에는 OpenAI STT를 기본 경로로 사용합니다.")
      .addDropdown((dropdown) => {
        for (const option of this.plugin.getSttProviderOptions()) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown
          .setValue(this.plugin.getConfiguredSttProvider())
          .onChange(async (value) => {
            this.plugin.settings.sttProvider = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    containerEl.createEl("p", {
      text: `현재 STT 경로: ${this.plugin.getSttProviderLabel(
        this.plugin.getConfiguredSttProvider()
      )} -> ${this.plugin.getSttProviderLabel(this.plugin.getResolvedSttProvider())}`,
    });

    new Setting(containerEl)
      .setName("기본 전사 언어")
      .setDesc("우측 패널에서 처음 열릴 때 선택되는 기본 언어입니다.")
      .addDropdown((dropdown) => {
        for (const option of this.plugin.getLanguageOptions()) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown
          .setValue(this.plugin.settings.sourceLanguage)
          .onChange(async (value) => {
            this.plugin.settings.sourceLanguage = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("시작 시 사이드바 자동 열기")
      .setDesc("플러그인 로드 직후 Voice Workflow 우측 패널을 자동으로 엽니다. 기본값은 꺼짐입니다.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.openSidebarOnStartup))
          .onChange(async (value) => {
            this.plugin.settings.openSidebarOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("기본 번역 옵션")
      .setDesc("영문/외국어 전사를 저장할 때 한국어 번역도 함께 만들지 기본값을 정합니다.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.translateToKorean))
          .onChange(async (value) => {
            this.plugin.settings.translateToKorean = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("녹음 전 동의 확인 요구")
      .setDesc("켜두면 우측 패널에서 참여자 동의 확인을 체크해야 녹음을 시작할 수 있습니다.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.requireConsentBeforeRecording))
          .onChange(async (value) => {
            this.plugin.settings.requireConsentBeforeRecording = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("동의 메시지")
      .setDesc("우측 패널의 동의문 복사 버튼에서 사용할 문구입니다.")
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_CONSENT_MESSAGE)
          .setValue(this.plugin.settings.consentMessage)
          .onChange(async (value) => {
            this.plugin.settings.consentMessage =
              value.trim() || DEFAULT_CONSENT_MESSAGE;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
      });

    containerEl.createEl("h3", { text: "AI 요약/번역 Provider" });

    new Setting(containerEl)
      .setName("AI Provider")
      .setDesc("요약 생성과 번역에 사용할 모델 공급자를 선택합니다.")
      .addDropdown((dropdown) => {
        for (const option of this.plugin.getAiProviderOptions()) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown
          .setValue(this.plugin.getActiveAiProvider())
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    containerEl.createEl("p", {
      text: `현재 선택: ${this.plugin.getAiProviderLabel(this.plugin.getActiveAiProvider())}`,
    });

    new Setting(containerEl)
      .setName("기본 요약 에이전트 지침")
      .setDesc("새 Voice Workflow 패널에서 기본으로 선택할 회의록 정리 방식입니다.")
      .addDropdown((dropdown) => {
        for (const option of this.plugin.getAgentInstructionOptions()) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown
          .setValue(this.plugin.settings.defaultAgentInstruction)
          .onChange(async (value) => {
            this.plugin.settings.defaultAgentInstruction = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("커스텀 에이전트 지침")
      .setDesc("에이전트 지침을 커스텀으로 선택했을 때 사용할 기본 규칙입니다.")
      .addTextArea((text) => {
        text
          .setPlaceholder("예: 결정사항과 리스크를 먼저 쓰고, 액션 아이템은 담당자/기한 표로 정리")
          .setValue(this.plugin.settings.customAgentInstruction)
          .onChange(async (value) => {
            this.plugin.settings.customAgentInstruction = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 5;
      });

    containerEl.createEl("h3", { text: "OpenAI 설정" });

    new Setting(containerEl)
      .setName("OpenAI API Key")
      .setDesc("OpenAI 요약/번역과 OpenAI 방식 STT에 사용됩니다. 로컬 data.json에 평문으로 저장됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openAiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI Base URL")
      .setDesc("OpenAI 호환 서버를 쓰는 경우 변경합니다.")
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.openAiApiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.openAiApiBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI STT Model")
      .setDesc("STT Provider가 OpenAI Compatible API일 때만 적용됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("gpt-4o-mini-transcribe")
          .setValue(this.plugin.settings.openAiTranscriptionModel)
          .onChange(async (value) => {
            this.plugin.settings.openAiTranscriptionModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI Summary Model")
      .setDesc("AI Provider가 OpenAI Compatible일 때 요약 생성과 번역에 사용됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.openAiSummaryModel)
          .onChange(async (value) => {
            this.plugin.settings.openAiSummaryModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Ollama 설정" });

    new Setting(containerEl)
      .setName("Ollama Base URL")
      .setDesc("로컬 Ollama 서버 주소입니다. 기본값은 http://localhost:11434 입니다.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaApiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaApiBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ollama Model")
      .setDesc("예: qwen3, llama3.2, gemma3. 먼저 터미널에서 ollama pull로 받아두세요.")
      .addText((text) =>
        text
          .setPlaceholder("qwen3")
          .setValue(this.plugin.settings.ollamaModel)
          .onChange(async (value) => {
            this.plugin.settings.ollamaModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Claude 설정" });

    new Setting(containerEl)
      .setName("Claude API Key")
      .setDesc("Anthropic Messages API에 사용됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Claude Base URL")
      .setDesc("기본값은 Anthropic 공식 API입니다.")
      .addText((text) =>
        text
          .setPlaceholder("https://api.anthropic.com/v1")
          .setValue(this.plugin.settings.anthropicApiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Claude Model")
      .setDesc("예: claude-sonnet-4-20250514")
      .addText((text) =>
        text
          .setPlaceholder("claude-sonnet-4-20250514")
          .setValue(this.plugin.settings.anthropicModel)
          .onChange(async (value) => {
            this.plugin.settings.anthropicModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Gemini 설정" });

    new Setting(containerEl)
      .setName("Gemini API Key")
      .setDesc("Google Gemini API에 사용됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("AIza...")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini Base URL")
      .setDesc("기본값은 Google Gemini API입니다.")
      .addText((text) =>
        text
          .setPlaceholder("https://generativelanguage.googleapis.com/v1beta")
          .setValue(this.plugin.settings.geminiApiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini Model")
      .setDesc("예: gemini-2.5-flash")
      .addText((text) =>
        text
          .setPlaceholder("gemini-2.5-flash")
          .setValue(this.plugin.settings.geminiModel)
          .onChange(async (value) => {
            this.plugin.settings.geminiModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("노트 저장 폴더")
      .setDesc("실시간 메모 결과 markdown 노트가 저장됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("Voice Workflow/Notes")
          .setValue(this.plugin.settings.noteFolder)
          .onChange(async (value) => {
            this.plugin.settings.noteFolder =
              value.trim() || DEFAULT_SETTINGS.noteFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("오디오 저장 폴더")
      .setDesc("녹음 원본 파일이 저장됩니다.")
      .addText((text) =>
        text
          .setPlaceholder("Voice Workflow/Audio")
          .setValue(this.plugin.settings.audioFolder)
          .onChange(async (value) => {
            this.plugin.settings.audioFolder =
              value.trim() || DEFAULT_SETTINGS.audioFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("직접 입력 기본 템플릿")
      .setDesc("Obsidian Templates 폴더에서 원하는 템플릿이 없을 때 사용할 기본 마크다운 템플릿입니다.")
      .addTextArea((text) => {
        text
          .setPlaceholder(DEFAULT_SUMMARY_TEMPLATE)
          .setValue(this.plugin.settings.customSummaryTemplate)
          .onChange(async (value) => {
            this.plugin.settings.customSummaryTemplate =
              value.trim() || DEFAULT_SUMMARY_TEMPLATE;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 16;
      });
  }
}
