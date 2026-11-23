import type { ReactNode } from "react";

export function ConnectionIcon({
  name,
  logo,
  icon,
}: {
  name: string;
  logo?: string | null;
  icon?: ReactNode;
}) {
  if (icon)
    return (
      <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground [&_svg]:size-7">
        {icon}
      </div>
    );
  return logo ? (
    <img
      src={logo}
      alt=""
      decoding="async"
      className="size-14 shrink-0 rounded-2xl bg-favicon-plate object-contain p-2"
    />
  ) : (
    <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent text-heading2 font-semibold text-foreground">
      {Array.from(name)[0]}
    </div>
  );
}
