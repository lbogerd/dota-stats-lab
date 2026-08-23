export const REJECTED_RECORD_TYPES: ReadonlySet<string> = new Set([
  "CSVCMsg_VoiceData",
  "CSVCMsg_VoiceInit",
  "CUserMessageVoiceMask",
  "CUserMessageSendAudio",
  "CUserMsg_ParticleManager",
  "CMsgSosStartSoundEvent",
  "CMsgSosSetSoundEventParams",
  "CMsgSosStopSoundEvent",
  "CMsgSosStopSoundEventHash",
  "CDOTAUserMsg_TE_UnitAnimation",
  "CDOTAUserMsg_TE_UnitAnimationEnd",
  "CDOTAUserMsg_TE_DotaBloodImpact",
  "CDOTAUserMsg_TE_Projectile",
  "CDOTAUserMsg_TE_ProjectileLoc",
  "CMsgTEEffectDispatch",
  "CDOTAUserMsg_KillEffect",
  "CSVCMsg_HLTVStatus",
  "CSVCMsg_PacketEntities",
]);

export const REJECTED_ENTITY_CLASSES: ReadonlySet<string> = new Set([
  "CParticleSystem",
  "CDOTA_DataSpectator",
  "CDOTASpectatorGraphManagerProxy",
  "CDOTACameraBounds",
]);

export const STORED_ENTITY_EVENT_TYPES: ReadonlySet<string> = new Set(["create", "delete"]);
export const STORED_CHECKPOINT_KINDS: ReadonlySet<string> = new Set(["creation", "completion"]);

export function shouldStoreRecordType(recordType: string): boolean {
  return !REJECTED_RECORD_TYPES.has(recordType);
}

export function shouldStoreEntityClass(className: string): boolean {
  return !REJECTED_ENTITY_CLASSES.has(className);
}

export function shouldStoreEntityEventType(eventType: string): boolean {
  return STORED_ENTITY_EVENT_TYPES.has(eventType);
}

export function shouldStoreCheckpointKind(checkpointKind: string): boolean {
  return STORED_CHECKPOINT_KINDS.has(checkpointKind);
}
