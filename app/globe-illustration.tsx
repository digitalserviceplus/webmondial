import { Globe2 } from "lucide-react";
import { T } from "@/components/language-switcher";

export default function GlobeIllustration() {
  return (
    <div className="globe-stage" role="img" aria-label="Globe terrestre illustré, relié aux communautés sportives du monde entier">
      <div className="globe-orbit globe-orbit-one" />
      <div className="globe-orbit globe-orbit-two" />
      <div className="globe-glow" />
      <svg className="world-globe" viewBox="0 0 520 520" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id="ocean" cx="32%" cy="24%" r="82%">
            <stop offset="0" stopColor="#193f62" />
            <stop offset=".58" stopColor="#102a45" />
            <stop offset="1" stopColor="#091929" />
          </radialGradient>
          <radialGradient id="shine" cx="20%" cy="15%" r="82%">
            <stop stopColor="white" stopOpacity=".2" />
            <stop offset=".62" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="#061320" stopOpacity=".5" />
          </radialGradient>
          <clipPath id="globe-clip">
            <circle cx="260" cy="260" r="214" />
          </clipPath>
        </defs>
        <circle cx="260" cy="260" r="225" fill="#60A5FA" fillOpacity=".06" />
        <circle cx="260" cy="260" r="215" fill="url(#ocean)" stroke="#72B4FF" strokeOpacity=".48" strokeWidth="1.5" />
        <g clipPath="url(#globe-clip)">
          <ellipse cx="260" cy="260" rx="113" ry="214" stroke="#92C2FF" strokeOpacity=".25" />
          <ellipse cx="260" cy="260" rx="189" ry="214" stroke="#92C2FF" strokeOpacity=".14" />
          <ellipse cx="260" cy="260" rx="214" ry="81" stroke="#92C2FF" strokeOpacity=".18" />
          <ellipse cx="260" cy="260" rx="214" ry="150" stroke="#92C2FF" strokeOpacity=".13" />
          <path d="M38 260h444M59 181h402M59 339h402" stroke="#92C2FF" strokeOpacity=".11" />
          <path d="M141 211c69-45 173-63 246-35M172 326c72 22 158 10 228-28M150 244c77 48 148 61 225 28" stroke="#E5F1FF" strokeOpacity=".56" strokeWidth="1.5" strokeDasharray="3 7" />
          <circle cx="141" cy="211" r="5" fill="#93C5FD" />
          <circle cx="387" cy="176" r="5" fill="#60A5FA" />
          <circle cx="172" cy="326" r="5" fill="#60A5FA" />
          <circle cx="400" cy="298" r="5" fill="#93C5FD" />
          <circle cx="260" cy="260" r="214" fill="url(#shine)" />
        </g>
        <circle cx="260" cy="260" r="214" stroke="#C5DDFF" strokeOpacity=".25" />
      </svg>
      <div className="globe-coordinate"><Globe2 size={14} /><span><T id="globeMotto" /></span></div>
    </div>
  );
}
