import { useEffect, useState } from "react";
import { useStore } from "../store";

export function TimelineScrubber4D() {
  const { timelineFrames, activeTurn, scrubToTurn, scene } = useStore();
  const [isPlaying, setIsPlaying] = useState(false);

  const turns = timelineFrames;
  const currentIdx = activeTurn
    ? turns.findIndex((t) => t.turn === activeTurn)
    : turns.length - 1;

  useEffect(() => {
    let timer: any;
    if (isPlaying && turns.length > 0) {
      timer = setInterval(() => {
        const nextIdx = (currentIdx + 1) % turns.length;
        scrubToTurn(turns[nextIdx].turn);
      }, 1200);
    }
    return () => clearInterval(timer);
  }, [isPlaying, currentIdx, turns]);

  if (turns.length === 0) return null;

  const currentFrame = turns[currentIdx] || turns[turns.length - 1];

  const handlePrev = () => {
    if (currentIdx > 0) {
      scrubToTurn(turns[currentIdx - 1].turn);
    }
  };

  const handleNext = () => {
    if (currentIdx < turns.length - 1) {
      scrubToTurn(turns[currentIdx + 1].turn);
    }
  };

  return (
    <div className="scrubber-4d-panel">
      <div className="scrubber-controls">
        <div className="playback-group">
          <button className="ghost small" onClick={handlePrev} disabled={currentIdx <= 0} title="Previous Turn">
            ⏮
          </button>
          <button
            className={`ghost small ${isPlaying ? "on" : ""}`}
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? "Pause 4D Playback" : "Play 4D History"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            className="ghost small"
            onClick={handleNext}
            disabled={currentIdx >= turns.length - 1}
            title="Next Turn"
          >
            ⏭
          </button>
        </div>

        <div className="scrubber-meta">
          <span className="scrubber-label">4D TIME:</span>
          <span className="mono bold scrubber-turn">
            {activeTurn ? activeTurn : "HEAD (Current)"}
          </span>
          {activeTurn && (
            <button className="ghost small reset-btn" onClick={() => scrubToTurn(null)}>
              Reset to HEAD
            </button>
          )}
        </div>

        <div className="scrubber-prompt mono" title={currentFrame.prompt}>
          {currentFrame.prompt}
        </div>

        {scene?.turn && (
          <div className="scrubber-stats">
            <span className="badge ok">Confidence: {Math.round((scene.confidence || 1) * 100)}%</span>
          </div>
        )}
      </div>

      <div className="track-container">
        <div className="track-timeline">
          {turns.map((t, idx) => {
            const isCur = idx === currentIdx;
            return (
              <button
                key={t.turn}
                className={`timeline-keyframe ${isCur ? "active" : ""}`}
                onClick={() => scrubToTurn(t.turn)}
                title={`${t.turn}: ${t.prompt}`}
              >
                <div className="keyframe-pip" />
                <span className="keyframe-label">{t.turn}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
