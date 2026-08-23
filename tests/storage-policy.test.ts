import test from "node:test";
import assert from "node:assert/strict";
import {
  REJECTED_ENTITY_CLASSES,
  REJECTED_RECORD_TYPES,
  STORED_CHECKPOINT_KINDS,
  STORED_ENTITY_EVENT_TYPES,
  shouldStoreCheckpointKind,
  shouldStoreEntityClass,
  shouldStoreEntityEventType,
  shouldStoreRecordType,
} from "../src/load/storage-policy.js";

test("policy sets expose the exact constants used by the decisions", () => {
  assert.equal(REJECTED_RECORD_TYPES.size, 18);
  assert.equal(REJECTED_ENTITY_CLASSES.size, 4);
  assert.deepEqual([...STORED_ENTITY_EVENT_TYPES], ["create", "delete"]);
  assert.deepEqual([...STORED_CHECKPOINT_KINDS], ["creation", "completion"]);
});

test("record policy rejects voice, sound, visual-effect, HLTV, and packet-entity data", () => {
  const rejected = [
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
  ];

  for (const recordType of rejected) {
    assert.equal(shouldStoreRecordType(recordType), false, recordType);
  }
});

test("record policy retains gameplay and analysis messages", () => {
  const retained = [
    "CMsgDOTACombatLogEntry",
    "CDOTAUserMsg_SpectatorPlayerUnitOrders",
    "CDOTAUserMsg_OverheadEvent",
    "CDOTAUserMsg_UnitEvent",
    "CDOTAUserMsg_FoundNeutralItem",
    "CDOTAUserMsg_CourierKilledAlert",
    "CMsgDOTAMatch",
    "CDOTAMatchMetadataFile",
  ];

  for (const recordType of retained) {
    assert.equal(shouldStoreRecordType(recordType), true, recordType);
  }
});

test("entity policy rejects presentation entities and retains observer wards", () => {
  for (const className of [
    "CParticleSystem",
    "CDOTA_DataSpectator",
    "CDOTASpectatorGraphManagerProxy",
    "CDOTACameraBounds",
  ]) {
    assert.equal(shouldStoreEntityClass(className), false, className);
  }

  for (const className of [
    "CDOTA_NPC_Observer_Ward",
    "CDOTA_NPC_Observer_Ward_TrueSight",
    "CDOTA_Item_ObserverWard",
  ]) {
    assert.equal(shouldStoreEntityClass(className), true, className);
  }
});

test("entity event policy retains only create and delete events", () => {
  assert.equal(shouldStoreEntityEventType("create"), true);
  assert.equal(shouldStoreEntityEventType("delete"), true);
  assert.equal(shouldStoreEntityEventType("update"), false);
  assert.equal(shouldStoreEntityEventType("CREATE"), false);
  assert.equal(shouldStoreEntityEventType("unknown"), false);
});

test("checkpoint policy retains only creation and completion checkpoints", () => {
  assert.equal(shouldStoreCheckpointKind("creation"), true);
  assert.equal(shouldStoreCheckpointKind("completion"), true);
  assert.equal(shouldStoreCheckpointKind("interval"), false);
  assert.equal(shouldStoreCheckpointKind("CREATION"), false);
  assert.equal(shouldStoreCheckpointKind("unknown"), false);
});
