const {
  ItemView,
  Notice,
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

const DEFAULT_STATUS_MESSAGE =
  "우측 패널에서 녹음한 뒤 템플릿과 저장 노트를 선택해 요약을 만들 수 있습니다.";

const SUMMARY_PLACEHOLDER = "_최종 요약을 아직 생성하지 않았습니다._";
const RECORDING_METADATA_HEADING = "녹음 메타데이터";
const RECORDING_ARCHIVE_HEADING = "원문 전사 및 저장 내역";
const TRANSCRIPT_HEADING = "원문 전사";
const TRANSLATED_TRANSCRIPT_HEADING = "번역 전사 (한국어)";
const SUMMARY_HEADING = "템플릿 요약";

const AI_PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
];

const AI_PROVIDER_MAP = AI_PROVIDER_OPTIONS.reduce((accumulator, option) => {
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
  return typeof process !== "undefined" && process.platform === "darwin"
    ? "macos-speech"
    : "openai";
}

function normalizeAiProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  return AI_PROVIDER_MAP[raw] ? raw : "openai";
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
  noteFolder: "Voice Workflow/Notes",
  audioFolder: "Voice Workflow/Audio",
  lastLoadedAt: "",
};

module.exports = class VoiceSummaryWorkflowPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.settings.lastLoadedAt = new Date().toISOString();
    await this.saveSettings();

    this.registerView(
      VIEW_TYPE,
      (leaf) => new VoiceSummarySidebarView(leaf, this)
    );

    this.addRibbonIcon("mic", "Voice Workflow 열기", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-voice-summary-workflow-sidebar",
      name: "Voice Workflow 열기",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "open-voice-summary-workflow",
      name: "Voice Workflow 열기 (기존 명령 호환)",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new VoiceSummaryWorkflowSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.activateView();
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded, {
      aiProvider,
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
      customSummaryTemplate,
      summaryTemplate: customSummaryTemplate,
    });
  }

  async saveSettings() {
    this.settings.aiProvider = normalizeAiProvider(this.settings.aiProvider);
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

  getAiProviderOptions() {
    return AI_PROVIDER_OPTIONS;
  }

  getAiProviderLabel(value) {
    return AI_PROVIDER_MAP[normalizeAiProvider(value)]?.label || AI_PROVIDER_MAP.openai.label;
  }

  getActiveAiProvider() {
    return normalizeAiProvider(this.settings.aiProvider);
  }

  getActiveAiApiKey() {
    switch (this.getActiveAiProvider()) {
      case "anthropic":
        return String(this.settings.anthropicApiKey || "").trim();
      case "gemini":
        return String(this.settings.geminiApiKey || "").trim();
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
      case "openai":
      default:
        return String(this.settings.openAiSummaryModel || "").trim();
    }
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

  getOpenAiTranscriptionModel() {
    return (
      String(this.settings.openAiTranscriptionModel || "").trim() ||
      DEFAULT_SETTINGS.openAiTranscriptionModel
    );
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

    await this.app.vault.modify(noteFile, normalizedContent);

    for (const view of openViews) {
      if (typeof view.save === "function") {
        await view.save();
      }
    }
  }

  appendRecordingToNote(
    content,
    { createdAt, topic, audioPath, sourceLanguage, transcript, translatedTranscript }
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

  async transcribeAudio({ audioBlob, audioPath, language }) {
    const provider = this.settings.sttProvider || "openai";

    if (provider === "macos-speech") {
      return this.transcribeWithMacOsSpeech(audioPath, language);
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

    const formData = new FormData();
    formData.append("file", audioBlob, filename);
    formData.append("model", this.getOpenAiTranscriptionModel());
    formData.append("response_format", "json");

    const resolvedLanguage = this.resolveOpenAiLanguage(language);
    if (resolvedLanguage) {
      formData.append("language", resolvedLanguage);
    }

    const response = await fetch(this.buildOpenAiApiUrl("/audio/transcriptions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const data = await this.parseApiResponse(response, "STT 요청");
    const transcript = typeof data.text === "string" ? data.text.trim() : "";

    if (!transcript) {
      throw new Error("STT 응답에 text 필드가 없습니다.");
    }

    return transcript;
  }

  async transcribeWithMacOsSpeech(audioPath, language) {
    if (typeof process === "undefined" || process.platform !== "darwin") {
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
            reject(
              new Error(
                `macOS Speech 전사 실패: ${detail}. 처음 실행이면 Obsidian 또는 osascript에 'Speech Recognition' 권한을 허용해야 할 수 있습니다.`
              )
            );
            return;
          }

          resolve((standardOutput || standardError || "").trim());
        }
      );
    });

    const transcript = String(transcriptText || "").trim();
    if (!transcript) {
      throw new Error("macOS Speech 전사 결과가 비어 있습니다.");
    }

    return transcript;
  }

  async translateTranscriptToKorean({ transcript, sourceLanguage }) {
    const apiKey = this.getActiveAiApiKey();
    if (!apiKey) {
      throw new Error(`${this.getAiProviderLabel(this.getActiveAiProvider())} API Key가 설정되지 않았습니다.`);
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

  async generateSummary({ title, topic, sourceText, templateText, requestText }) {
    const apiKey = this.getActiveAiApiKey();
    if (!apiKey) {
      throw new Error(`${this.getAiProviderLabel(this.getActiveAiProvider())} API Key가 설정되지 않았습니다.`);
    }

    const summary = await this.generateTextWithProvider({
      label: "요약 요청",
      systemPrompt: [
        "당신은 음성 메모와 초안 문서를 정리하는 한국어 요약 도우미다.",
        "제공된 템플릿 구조를 최대한 유지하고, 원문에 없는 사실은 추측하지 마라.",
        "출력은 마크다운 본문만 반환한다.",
      ].join(" "),
      userPrompt: this.buildSummaryPrompt({
        title,
        topic,
        sourceText,
        templateText,
        requestText,
      }),
      temperature: 0.2,
    });

    if (!summary) {
      throw new Error("요약 응답이 비어 있습니다.");
    }

    return summary;
  }

  canUseAiSummary() {
    return Boolean(this.getActiveAiApiKey());
  }

  buildSummaryFallbackDraft({ templateText, requestText }) {
    const normalizedTemplate = this.normalizeText(templateText);
    const normalizedRequest = this.normalizeText(requestText);
    const guidanceBlock = [
      "> 자동 요약을 생성하지 않았습니다.",
      `> 이유: ${this.getAiProviderLabel(this.getActiveAiProvider())} API Key가 없어 LLM 요약 단계를 건너뛰었습니다.`,
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

  buildSummaryPrompt({ title, topic, sourceText, templateText, requestText }) {
    const normalizedTemplate = this.normalizeText(templateText);
    const normalizedRequest = this.normalizeText(requestText);

    if (normalizedTemplate) {
      return [
        "아래 메모/전사 내용을 템플릿에 맞춰 한국어로 정리해 주세요.",
        "",
        `제목: ${title || "미입력"}`,
        `주제: ${topic || "미입력"}`,
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
      "",
      "요청사항:",
      normalizedRequest || "핵심 내용, 결정사항, 실행 항목이 드러나게 간결한 마크다운 노트로 정리합니다.",
      "",
      "요약 규칙:",
      "- frontmatter/속성 블록이 있으면 문서 최상단에 유지합니다.",
      "- 결과는 노트의 메인 내용으로 바로 사용할 수 있게 작성합니다.",
      "- 원문에서 확인되는 사실만 반영합니다.",
      "- 불필요한 서론 없이 바로 결과를 작성합니다.",
      "- 실행 항목이 있으면 체크리스트로 정리합니다.",
      "",
      "정리 대상 본문:",
      sourceText.trim(),
    ].join("\n");
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
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (!normalizedQuery) {
          return true;
        }

        return file.path.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 200);
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
    await this.app.vault.modify(file, updatedContent);
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
    await this.app.vault.adapter.writeBinary(path, data);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`오디오 파일을 확인할 수 없습니다: ${path}`);
    }

    return file;
  }

  async parseApiResponse(response, label) {
    const rawText = await response.text();
    let data = {};

    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (error) {
        if (!response.ok) {
          throw new Error(`${label} 실패: ${rawText}`);
        }
        throw new Error(`${label} 응답을 JSON으로 해석하지 못했습니다.`);
      }
    }

    if (!response.ok) {
      const apiMessage =
        data?.error?.message || data?.message || rawText || `HTTP ${response.status}`;
      throw new Error(`${label} 실패: ${apiMessage}`);
    }

    return data;
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
    const basePath = this.app.vault.adapter.basePath;

    if (!basePath) {
      throw new Error("현재 환경에서는 로컬 스크립트 경로를 찾을 수 없습니다.");
    }

    return path.join(
      basePath,
      this.app.vault.configDir,
      "plugins",
      this.manifest.id,
      relativePath
    );
  }

  getVaultAbsolutePath(relativePath) {
    const path = require("path");
    const basePath = this.app.vault.adapter.basePath;

    if (!basePath) {
      throw new Error("현재 환경에서는 볼트 절대 경로를 계산할 수 없습니다.");
    }

    return path.join(basePath, normalizePath(relativePath));
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
      const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
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

    if (!apiKey) {
      throw new Error(`${this.getAiProviderLabel(provider)} API Key가 설정되지 않았습니다.`);
    }
    if (!model) {
      throw new Error(`${this.getAiProviderLabel(provider)} 모델이 설정되지 않았습니다.`);
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
    const mergedFrontmatter = summaryFrontmatter || existingFrontmatter;
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
      mergedFrontmatter ? `${mergedFrontmatter}\n` : "",
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
    this.transcriptFeedItems = [];
    this.templateFiles = [];
    this.noteOptions = [];
    this.recordedAudioBlob = null;
    this.recordingCreatedAt = null;
    this.state = {
      activeTab: "transcript",
      noteTitle: "",
      topic: "",
      sourceLanguage: this.plugin.settings.sourceLanguage,
      translateToKorean: Boolean(this.plugin.settings.translateToKorean),
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

    const transcriptFeedHeader = this.transcriptPanelEl.createDiv({
      cls: "voice-workflow-section-header",
    });
    transcriptFeedHeader.createEl("h3", { text: "실시간 전사" });
    transcriptFeedHeader.createEl("span", {
      cls: "voice-workflow-section-caption",
      text: "녹음 중 문장이 여기 쌓입니다.",
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
    this.processRecordingButton = summaryFooter.createEl("button", {
      text: "현재 전사 요약 저장",
      cls: "mod-cta",
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

    this.statusEl.setText(this.state.statusMessage || DEFAULT_STATUS_MESSAGE);
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

    const interimTranscript = this.liveInterimTranscript.trim();
    this.transcriptFeedEl.empty();

    if (this.transcriptFeedItems.length === 0 && !interimTranscript) {
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

    if (interimTranscript) {
      const row = this.transcriptFeedEl.createDiv({
        cls: "voice-workflow-feed-row is-interim",
      });
      row.createEl("span", {
        cls: "voice-workflow-feed-time",
        text: "진행 중",
      });
      row.createDiv({
        cls: "voice-workflow-feed-bubble",
        text: interimTranscript,
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

  setStatus(message, isError = false) {
    this.state.statusMessage = message;
    this.state.statusIsError = isError;
    this.updateStatusUi();
  }

  setBusy(isBusy) {
    this.isBusy = isBusy;
    this.updateButtonState();
  }

  updateButtonState() {
    if (this.startButton) {
      this.startButton.disabled = this.isBusy || this.isRecording;
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
      this.processRecordingButton.disabled = this.isBusy || !this.recordedAudioBlob;
      this.processRecordingButton.setText(
        this.plugin.canUseAiSummary() ? "현재 전사 요약 저장" : "전사 초안 저장"
      );
    }

    this.updateTransportUi();
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
      : `${providerLabel} API Key가 없어 템플릿/요청사항 기반 초안만 저장합니다.`;

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

    this.liveFinalSegments.push(normalized);
    this.transcriptFeedItems.push({
      text: normalized,
      time: this.formatFeedTimestamp(date),
    });
    this.liveInterimTranscript = "";
    this.updateTranscriptUi();
  }

  replaceLiveTranscriptSegments(transcript, date = new Date()) {
    const normalized = this.plugin.normalizeText(transcript);
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

    try {
      this.setBusy(true);
      this.setStatus("마이크와 실시간 전사를 시작합니다...");
      this.setActiveTab("transcript");
      this.clearLiveTranscript(false);
      this.recordedAudioBlob = null;
      this.recordingCreatedAt = null;
      this.state.finalTranscript = "";
      this.state.savedAudioPath = "";
      this.state.translatedTranscript = "";
      this.realtimeRecognitionDisabledForSession = false;
      this.isPaused = false;
      this.recordedElapsedMs = 0;
      this.previewProcessedBufferCount = 0;
      this.previewBusy = false;
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
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
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
      this.startPreviewLoop();
      this.recordingStartedAt = Date.now();
      this.startTimer();
      const liveRecognitionStarted = await this.startSpeechRecognition();
      if (liveRecognitionStarted) {
        this.setStatus("녹음 중입니다. 실시간 원문 전사를 확인하면서 종료하세요.");
      } else {
        this.setStatus(
          "녹음 중입니다. 맥 로컬 STT 미리보기로 몇 초 단위 원문 전사를 갱신하고, 종료 시 최종 STT로 한 번 더 정리합니다."
        );
      }
    } catch (error) {
      await this.stopSpeechRecognition();
      this.teardownRecorder();
      await this.closeAudioContext();
      this.releaseStream();
      this.setStatus(
        `녹음을 시작하지 못했습니다: ${error.message || String(error)}`,
        true
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
          : "녹음을 다시 시작했습니다. 로컬 STT 미리보기로 원문 전사를 계속 갱신합니다."
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
      const result = await this.finalizeStoppedRecording(audioBlob);

      this.recordedAudioBlob = audioBlob;
      this.recordingCreatedAt = createdAt;
      this.state.finalTranscript = result.transcript || "";
      this.state.savedAudioPath = "";
      this.state.translatedTranscript = result.translatedTranscript || "";
      this.replaceLiveTranscriptSegments(result.transcript, createdAt);

      if (!this.state.newNoteTitle.trim()) {
        this.state.newNoteTitle =
          this.state.noteTitle.trim() || `음성 메모 ${this.plugin.formatTimestamp(createdAt)}`;
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
            : "녹음이 끝났습니다. 템플릿 또는 요청사항과 저장할 노트를 선택하면 API Key 없이 초안 저장을 진행합니다."
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

  async finalizeStoppedRecording(audioBlob) {
    let transcriptError = null;
    let transcript = "";

    try {
      transcript = await this.transcribePreviewChunk(audioBlob);
    } catch (error) {
      transcriptError = error;
      transcript = this.getLiveTranscript();
    }

    transcript = this.plugin.normalizeText(transcript || this.getLiveTranscript());
    if (!transcript) {
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
    };
  }

  buildSummarySourceForTarget(content, transcript, translatedTranscript) {
    const currentNoteBody = this.plugin
      .removeMarkdownSection(this.plugin.stripFrontmatter(content), SUMMARY_HEADING)
      .trim();
    const latestRecordingText =
      this.plugin.normalizeText(translatedTranscript) ||
      this.plugin.normalizeText(transcript);

    return [currentNoteBody, "## 이번 녹음 전사", latestRecordingText]
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
          : "API Key 없이 전사 초안을 노트에 저장하는 중입니다..."
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
        this.state.translatedTranscript
      );

      const summary = this.plugin.canUseAiSummary()
        ? await this.plugin.generateSummary({
            title: noteTitle,
            topic: this.state.topic.trim(),
            sourceText,
            templateText,
            requestText,
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

      this.state.selectedFilePath = noteFile.path;
      this.refreshNoteOptions();
      this.renderNoteOptions();
      await this.app.workspace.getLeaf(true).openFile(noteFile);

      if (this.plugin.canUseAiSummary()) {
        this.setStatus("요약을 노트에 저장했습니다.");
        new Notice("녹음 요약을 노트에 저장했습니다.");
      } else {
        this.setStatus("API Key 없이 전사 초안을 노트에 저장했습니다.");
        new Notice("API Key 없이 전사 초안을 노트에 저장했습니다.");
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
    this.liveInterimTranscript = "";
    this.updateTranscriptUi();
  }

  getLiveTranscript() {
    return this.plugin.normalizeText(
      [this.liveFinalSegments.join("\n"), this.liveInterimTranscript]
        .filter(Boolean)
        .join("\n")
    );
  }

  startPreviewLoop() {
    this.stopPreviewLoop();
    this.previewTimerId = window.setInterval(() => {
      void this.maybeTranscribePreview(false);
    }, 2500);
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
      : Math.floor(this.sampleRate * 1.8);

    if (totalSamples < minimumSamples) {
      return;
    }

    this.previewBusy = true;

    try {
      const previewBlob = this.buildWavBlobFromBuffers(newBuffers);
      const transcript = await this.transcribePreviewChunk(previewBlob);
      if (transcript) {
        this.appendLiveTranscriptSegment(transcript);
      }
      this.previewProcessedBufferCount = endIndex;
    } catch (error) {
      console.error("Voice Workflow: preview transcription failed", error);
    } finally {
      this.previewBusy = false;
    }
  }

  async transcribePreviewChunk(audioBlob) {
    const provider = this.plugin.settings.sttProvider || "openai";
    const canUseMacPreview =
      typeof process !== "undefined" && process.platform === "darwin";

    if (canUseMacPreview) {
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

    if (provider === "macos-speech") {
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
    if (typeof process !== "undefined" && process.platform === "darwin") {
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
      .setDesc("저장 후 보정 STT에 사용됩니다. macOS에서는 로컬 Speech.framework를 쓸 수 있습니다.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("macos-speech", "macOS Local Speech")
          .addOption("openai", "OpenAI Compatible API")
          .setValue(this.plugin.settings.sttProvider)
          .onChange(async (value) => {
            this.plugin.settings.sttProvider = value;
            await this.plugin.saveSettings();
          })
      );

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
