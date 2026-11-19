import ExpoModulesCore
import MusicKit

internal final class SongNotFoundException: GenericException<String> {
  override var reason: String {
    "No Apple Music song with id \(param)"
  }
}

internal final class NotAuthorizedException: Exception {
  override var reason: String {
    "Apple Music access hasn't been granted"
  }
}

/// Full-track Apple Music playback for subscribers, through MusicKit's
/// ApplicationMusicPlayer. Audio plays in-app; nothing is downloaded or re-hosted.
public class AppleMusicModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleMusic")

    /// Asks for Apple Music access. Returns "authorized", "denied", "restricted" or "notDetermined".
    AsyncFunction("authorize") { () async -> String in
      let status = await MusicAuthorization.request()
      return AppleMusicModule.describe(status)
    }

    AsyncFunction("authorizationStatus") { () -> String in
      return AppleMusicModule.describe(MusicAuthorization.currentStatus)
    }

    /// True when the user has granted access and their subscription can play the full catalog.
    AsyncFunction("canPlayCatalog") { () async -> Bool in
      guard MusicAuthorization.currentStatus == .authorized else { return false }
      do {
        let subscription = try await MusicSubscription.current
        return subscription.canPlayCatalogContent
      } catch {
        return false
      }
    }

    /// A Music User Token for this person, so VYBZ's server can read their recently played
    /// songs (only when they opt in to "Count my plays"). Needs Apple Music access.
    AsyncFunction("userToken") { (developerToken: String) async throws -> String in
      guard MusicAuthorization.currentStatus == .authorized else {
        throw NotAuthorizedException()
      }
      return try await MusicUserTokenProvider().userToken(for: developerToken, options: [])
    }

    /// Plays a catalog song from the start, replacing whatever was queued.
    AsyncFunction("play") { (catalogId: String) async throws in
      guard MusicAuthorization.currentStatus == .authorized else {
        throw NotAuthorizedException()
      }
      let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(catalogId))
      let response = try await request.response()
      guard let song = response.items.first else {
        throw SongNotFoundException(catalogId)
      }
      try await AppleMusicModule.start(song)
    }

    AsyncFunction("resume") { () async throws in
      try await AppleMusicModule.resume()
    }

    AsyncFunction("pause") { () async in
      await AppleMusicModule.pause()
    }

    /// { playing: Bool, position: seconds }
    AsyncFunction("status") { () async -> [String: Any] in
      return await AppleMusicModule.snapshot()
    }
  }

  @MainActor
  private static func start(_ song: Song) async throws {
    let player = ApplicationMusicPlayer.shared
    player.queue = [song]
    try await player.play()
  }

  @MainActor
  private static func resume() async throws {
    try await ApplicationMusicPlayer.shared.play()
  }

  @MainActor
  private static func pause() {
    ApplicationMusicPlayer.shared.pause()
  }

  @MainActor
  private static func snapshot() -> [String: Any] {
    let player = ApplicationMusicPlayer.shared
    return [
      "playing": player.state.playbackStatus == .playing,
      "position": player.playbackTime,
    ]
  }

  private static func describe(_ status: MusicAuthorization.Status) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }
}
