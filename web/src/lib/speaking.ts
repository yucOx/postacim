import { useEffect, useState } from 'react';
import { ParticipantEvent } from 'livekit-client';
import type { Participant } from 'livekit-client';

/**
 * LiveKit'in useIsSpeaking hook'u yerine güvenli hook.
 * Katılımcı henüz bağlanmamışken veya undefined iken "No participant provided"
 * hatası fırlatmaz, güvenle false döner; bağlandığında isSpeakingChanged ile dinler.
 */
export function useSafeIsSpeaking(participant?: Participant | null): boolean {
  const [speaking, setSpeaking] = useState(() => participant?.isSpeaking ?? false);

  useEffect(() => {
    if (!participant) {
      setSpeaking(false);
      return;
    }
    const onSpeaking = (val: boolean) => setSpeaking(val);
    participant.on(ParticipantEvent.IsSpeakingChanged, onSpeaking);
    setSpeaking(participant.isSpeaking);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, onSpeaking);
    };
  }, [participant]);

  return speaking;
}
