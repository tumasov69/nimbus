import { useTranslation } from "react-i18next";
import { useStore } from "../store";
import type { Instance, ProjectType } from "../types";
import { LoaderBadge, Modal } from "./ui";

/** Instances that can receive a project of the given type. */
export function eligibleInstances(
  instances: Instance[],
  type: ProjectType,
): Instance[] {
  return type === "mod"
    ? instances.filter((i) => i.loader !== "vanilla")
    : instances;
}

export function InstancePickerModal({
  type,
  onPick,
  onClose,
}: {
  type: ProjectType;
  onPick: (instance: Instance) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { instances } = useStore();
  return (
    <Modal title={t("browse.pickInstance")} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {eligibleInstances(instances, type).map((inst) => (
          <button
            key={inst.id}
            className="card flex items-center gap-3 p-3.5 text-left transition-all hover:bg-card-hover cursor-pointer"
            onClick={() => {
              onClose();
              onPick(inst);
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-t1">{inst.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-t3">
                <LoaderBadge loader={inst.loader} />
                {inst.mcVersion}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
