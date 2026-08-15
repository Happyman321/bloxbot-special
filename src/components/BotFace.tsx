import {
  type CompanionAccessoryId,
  type CompanionEyeId,
  type CompanionMood,
  type CompanionShellId,
  DEFAULT_COMPANION_PREFERENCES,
  resolveCompanionShell,
} from "@/lib/companion";
import { THEME_BY_ID, type ThemeDefinition } from "@/lib/themes";

interface BotFaceProps {
  mood?: CompanionMood;
  accessory?: CompanionAccessoryId;
  accessoryBrightness?: number;
  eyes?: CompanionEyeId;
  shell?: CompanionShellId;
  theme?: ThemeDefinition;
  size?: number;
  animated?: boolean;
  showAccessory?: boolean;
  preserveEyeStyle?: boolean;
  className?: string;
  title?: string;
}

function Accessory({ id, detail }: { id: CompanionAccessoryId; detail: string }) {
  if (id === "none") return null;
  if (id === "antenna") {
    return (
      <g className="bloxbot-accessory">
        <path d="M256 100V45" stroke={detail} strokeWidth="22" strokeLinecap="round" />
        <circle cx="256" cy="34" r="22" fill={detail} />
      </g>
    );
  }
  if (id === "propeller") {
    return (
      <g className="bloxbot-accessory bloxbot-propeller">
        <path d="M256 101V58" stroke={detail} strokeWidth="18" strokeLinecap="round" />
        <path
          d="M146 34C184 2 232 12 256 34C280 12 328 2 366 34C328 68 280 57 256 38C232 57 184 68 146 34Z"
          fill={detail}
        />
      </g>
    );
  }
  if (id === "cap") {
    return (
      <g className="bloxbot-accessory">
        <path d="M124 130C137 57 194 20 270 26C331 31 371 71 378 127L124 130Z" fill={detail} />
        <path d="M259 119C334 102 407 111 446 143C377 151 316 148 259 138V119Z" fill={detail} />
      </g>
    );
  }
  if (id === "beanie") {
    return (
      <g className="bloxbot-accessory">
        <path d="M118 132C126 60 181 19 256 19C331 19 386 60 394 132H118Z" fill={detail} />
        <rect x="105" y="111" width="302" height="57" rx="27" fill={detail} />
        <circle cx="256" cy="21" r="25" fill={detail} />
      </g>
    );
  }
  if (id === "crown") {
    return (
      <g className="bloxbot-accessory">
        <path d="M118 129L139 39L211 88L256 23L301 88L373 39L394 129H118Z" fill={detail} />
        <rect x="118" y="119" width="276" height="39" rx="15" fill={detail} />
      </g>
    );
  }
  return (
    <g className="bloxbot-accessory">
      <path d="M116 130L253 6L368 130H116Z" fill={detail} />
      <path d="M77 135C157 110 351 110 435 135C364 172 151 172 77 135Z" fill={detail} />
      <circle cx="285" cy="57" r="16" fill="var(--background)" opacity="0.8" />
    </g>
  );
}

function Eyes({
  id,
  mood,
  color,
  preserveStyle,
}: {
  id: CompanionEyeId;
  mood: CompanionMood;
  color: string;
  preserveStyle: boolean;
}) {
  if ((!preserveStyle && mood === "success") || id === "happy") {
    return (
      <g className="bloxbot-eyes" fill="none" stroke={color} strokeWidth="25" strokeLinecap="round">
        <path d="M139 245C158 218 189 218 209 245" />
        <path d="M303 245C323 218 354 218 373 245" />
      </g>
    );
  }
  if (mood === "error") {
    return (
      <g className="bloxbot-eyes" fill="none" stroke={color} strokeWidth="25" strokeLinecap="round">
        <path d="M139 226L210 246" />
        <path d="M302 246L373 226" />
      </g>
    );
  }
  if (mood === "attention") {
    return (
      <g className="bloxbot-eyes bloxbot-eye">
        <circle cx="176" cy="232" r="36" fill={color} />
        <circle cx="336" cy="232" r="36" fill={color} />
      </g>
    );
  }
  if (id === "visor") {
    return (
      <g className="bloxbot-eye">
        <rect x="117" y="205" width="278" height="67" rx="33" fill={color} />
        <rect x="158" y="220" width="49" height="13" rx="6" fill="white" opacity="0.4" />
      </g>
    );
  }
  if (id === "round") {
    return (
      <g className="bloxbot-eye" fill={color}>
        <circle cx="176" cy="232" r="31" />
        <circle cx="336" cy="232" r="31" />
      </g>
    );
  }
  if (id === "pixel") {
    return (
      <g className="bloxbot-eye" fill={color}>
        <rect x="143" y="199" width="66" height="66" />
        <rect x="303" y="199" width="66" height="66" />
      </g>
    );
  }
  return (
    <g className="bloxbot-eye" fill={color}>
      <rect x="143" y="199" width="66" height="66" rx="23" />
      <rect x="303" y="199" width="66" height="66" rx="23" />
    </g>
  );
}

function Mouth({ mood, color }: { mood: CompanionMood; color: string }) {
  if (mood === "error") {
    return (
      <path
        d="M177 383C199 351 226 339 256 339C286 339 313 351 335 383"
        fill="none"
        stroke={color}
        strokeWidth="27"
        strokeLinecap="round"
      />
    );
  }
  if (mood === "attention") {
    return <circle cx="256" cy="359" r="29" fill="none" stroke={color} strokeWidth="24" />;
  }
  if (mood === "thinking") {
    return (
      <g fill={color}>
        <circle cx="218" cy="357" r="10" />
        <circle cx="256" cy="357" r="10" />
        <circle cx="294" cy="357" r="10" />
      </g>
    );
  }
  return (
    <path
      d="M170 335C194 374 222 390 256 390C290 390 318 374 342 335"
      fill="none"
      stroke={color}
      strokeWidth="28"
      strokeLinecap="round"
    />
  );
}

function BotFace({
  mood = "idle",
  accessory = DEFAULT_COMPANION_PREFERENCES.accessory,
  accessoryBrightness = DEFAULT_COMPANION_PREFERENCES.accessoryBrightness,
  eyes = DEFAULT_COMPANION_PREFERENCES.eyes,
  shell = DEFAULT_COMPANION_PREFERENCES.shell,
  theme = THEME_BY_ID.paper,
  size = 64,
  animated = true,
  showAccessory = true,
  preserveEyeStyle = false,
  className = "",
  title,
}: BotFaceProps) {
  const colors =
    shell === "theme"
      ? { shell: "var(--primary)", features: "var(--primary-foreground)", detail: "var(--ring)" }
      : resolveCompanionShell(shell, theme);
  const animationClass = animated ? `bloxbot-mood-${mood}` : "";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${animationClass} ${className}`.trim()}
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <rect x="40" y="92" width="432" height="372" rx="106" fill={colors.shell} />
      {showAccessory && (
        <g style={{ filter: `brightness(${accessoryBrightness}%)` }}>
          <Accessory id={accessory} detail={colors.detail} />
        </g>
      )}
      <Eyes id={eyes} mood={mood} color={colors.features} preserveStyle={preserveEyeStyle} />
      <Mouth mood={mood} color={colors.features} />
      <circle cx="97" cy="314" r="15" fill={colors.detail} opacity="0.65" />
      <circle cx="415" cy="314" r="15" fill={colors.detail} opacity="0.65" />
    </svg>
  );
}

export default BotFace;
