import Foundation
import Speech

enum CliError: LocalizedError {
    case usage
    case fileNotFound(String)
    case authorizationDenied
    case recognizerUnavailable(String)
    case emptyTranscript
    case timedOut

    var errorDescription: String? {
        switch self {
        case .usage:
            return "Usage: swift macos-transcribe.swift <audio-path> [locale]"
        case .fileNotFound(let path):
            return "Audio file not found: \(path)"
        case .authorizationDenied:
            return "Speech recognition authorization was denied. Allow Obsidian in System Settings > Privacy & Security > Speech Recognition."
        case .recognizerUnavailable(let locale):
            return "Speech recognizer is unavailable for locale: \(locale)"
        case .emptyTranscript:
            return "Speech recognizer returned an empty transcript."
        case .timedOut:
            return "Speech recognition timed out."
        }
    }
}

func requestSpeechAuthorization() throws {
    let semaphore = DispatchSemaphore(value: 0)
    var status: SFSpeechRecognizerAuthorizationStatus = .notDetermined

    SFSpeechRecognizer.requestAuthorization { authorizationStatus in
        status = authorizationStatus
        semaphore.signal()
    }

    _ = semaphore.wait(timeout: .now() + 10)

    guard status == .authorized else {
        throw CliError.authorizationDenied
    }
}

func transcribeAudioFile(at path: String, localeIdentifier: String) throws -> String {
    guard FileManager.default.fileExists(atPath: path) else {
        throw CliError.fileNotFound(path)
    }

    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)),
          recognizer.isAvailable else {
        throw CliError.recognizerUnavailable(localeIdentifier)
    }

    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    request.shouldReportPartialResults = false

    let semaphore = DispatchSemaphore(value: 0)
    var transcript = ""
    var recognitionError: Error?

    let task = recognizer.recognitionTask(with: request) { result, error in
        if let result {
            transcript = result.bestTranscription.formattedString
            if result.isFinal {
                semaphore.signal()
            }
            return
        }

        if let error {
            recognitionError = error
            semaphore.signal()
        }
    }

    let waitResult = semaphore.wait(timeout: .now() + 120)
    task.cancel()

    if waitResult == .timedOut {
        throw CliError.timedOut
    }

    if let recognitionError {
        throw recognitionError
    }

    let trimmedTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedTranscript.isEmpty else {
        throw CliError.emptyTranscript
    }

    return trimmedTranscript
}

@main
struct MacOSTranscribeCLI {
    static func main() {
        do {
            guard CommandLine.arguments.count >= 2 else {
                throw CliError.usage
            }

            let audioPath = CommandLine.arguments[1]
            let localeIdentifier = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : "ko-KR"

            try requestSpeechAuthorization()
            let transcript = try transcribeAudioFile(at: audioPath, localeIdentifier: localeIdentifier)
            print(transcript)
        } catch {
            fputs("\(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}
