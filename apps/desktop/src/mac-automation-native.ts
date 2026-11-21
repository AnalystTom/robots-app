import type { LibraryHandle } from "koffi";
import koffi from "koffi";

type KoffiFunction = ReturnType<LibraryHandle["func"]>;

const TYPE_APPLICATION_BUNDLE_ID = 0x62756e64;
const TYPE_WILDCARD = 0x2a2a2a2a;

let native: { create: KoffiFunction; dispose: KoffiFunction; determine: KoffiFunction } | undefined;

function load() {
  if (native) return native;
  const services = koffi.load("/System/Library/Frameworks/CoreServices.framework/CoreServices");
  koffi.struct("RobotsAEDesc", { descriptorType: "uint32", dataHandle: "void *" });
  native = {
    create: services.func(
      "int16 AECreateDesc(uint32 typeCode, const void *dataPtr, long dataSize, _Out_ RobotsAEDesc *result)",
    ),
    dispose: services.func("int16 AEDisposeDesc(_Inout_ RobotsAEDesc *theAEDesc)"),
    determine: services.func(
      "int32 AEDeterminePermissionToAutomateTarget(const RobotsAEDesc *target, uint32 theAEEventClass, uint32 theAEEventID, bool askUserIfNeeded)",
    ),
  };
  return native;
}

export function automationPermissionCode(bundleId: string): number | null {
  if (process.platform !== "darwin") return null;
  const { create, dispose, determine } = load();
  const data = Buffer.from(bundleId, "utf8");
  const target = { descriptorType: 0, dataHandle: null };
  if ((create(TYPE_APPLICATION_BUNDLE_ID, data, data.length, target) as number) !== 0) return null;
  try {
    return determine(target, TYPE_WILDCARD, TYPE_WILDCARD, false) as number;
  } finally {
    dispose(target);
  }
}
