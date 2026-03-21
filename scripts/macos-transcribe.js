ObjC.import("Foundation");
ObjC.import("Speech");

function unwrap(value) {
  return ObjC.unwrap(value);
}

function isRealObjCValue(value) {
  return value !== undefined && value !== null && String(value) !== "[id nil]";
}

function resolveLocaleIdentifier(rawValue) {
  const locale = String(rawValue || "").trim();
  if (!locale || locale.toLowerCase() === "auto") {
    return unwrap($.NSLocale.autoupdatingCurrentLocale.localeIdentifier);
  }
  return locale;
}

function requestAuthorization() {
  const currentStatus = $.SFSpeechRecognizer.authorizationStatus;
  if (currentStatus === $.SFSpeechRecognizerAuthorizationStatusAuthorized) {
    return;
  }

  let done = false;
  let resolvedStatus = currentStatus;

  $.SFSpeechRecognizer.requestAuthorization(function (status) {
    resolvedStatus = status;
    done = true;
  });

  let attempts = 0;
  while (!done && attempts < 50) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
    attempts += 1;
  }

  if (resolvedStatus !== $.SFSpeechRecognizerAuthorizationStatusAuthorized) {
    throw new Error(
      "Speech recognition authorization was denied. Allow Obsidian or osascript in System Settings > Privacy & Security > Speech Recognition."
    );
  }
}

function transcribeAudioFile(audioPath, localeIdentifier) {
  const recognizerLocale = $.NSLocale.alloc.initWithLocaleIdentifier(localeIdentifier);
  const recognizer = $.SFSpeechRecognizer.alloc.initWithLocale(recognizerLocale);

  if (!recognizer || !recognizer.isAvailable) {
    throw new Error("Speech recognizer is unavailable for locale: " + localeIdentifier);
  }

  const url = $.NSURL.fileURLWithPath(audioPath);
  const request = $.SFSpeechURLRecognitionRequest.alloc.initWithURL(url);
  request.shouldReportPartialResults = false;

  let done = false;
  let transcript = "";
  let recognitionError = "";
  recognizer.recognitionTaskWithRequestResultHandler(
    request,
    function (result, error) {
      if (isRealObjCValue(error)) {
        recognitionError = unwrap(error.localizedDescription);
        done = true;
        return;
      }

      if (isRealObjCValue(result)) {
        transcript = unwrap(result.bestTranscription.formattedString);
        if (unwrap(result.isFinal)) {
          done = true;
        }
      }
    }
  );

  let attempts = 0;
  while (!done && attempts < 600) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
    attempts += 1;
  }

  if (!done) {
    throw new Error("Speech recognition timed out.");
  }

  if (recognitionError) {
    throw new Error(recognitionError);
  }

  transcript = String(transcript || "").trim();
  if (!transcript) {
    throw new Error("Speech recognizer returned an empty transcript.");
  }

  return transcript;
}

function run(argv) {
  if (!argv || argv.length < 1) {
    throw new Error("Usage: osascript -l JavaScript macos-transcribe.js <audio-path> [locale]");
  }

  const audioPath = argv[0];
  const localeIdentifier = resolveLocaleIdentifier(argv[1]);

  requestAuthorization();
  const transcript = transcribeAudioFile(audioPath, localeIdentifier);
  console.log(transcript);
}
