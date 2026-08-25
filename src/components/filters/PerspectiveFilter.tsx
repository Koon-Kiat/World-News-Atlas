import { getCountryName } from "@/lib/news/countries/metadata";
import type { SourcePerspective } from "@/lib/news/types";

interface PerspectiveFilterProps {
  countries: string[];
  value: SourcePerspective;
  onChange: (value: SourcePerspective) => void;
}

export function PerspectiveFilter({ countries, value, onChange }: PerspectiveFilterProps) {
  const options: Array<{ value: SourcePerspective; label: string }> =
    countries.length === 1
      ? [
          { value: "all", label: "All" },
          { value: "local", label: "Local" },
          { value: "international", label: "International" },
        ]
      : countries.length === 2
        ? [
            { value: "all", label: "All sources" },
            { value: "first-country", label: getCountryName(countries[0]) },
            { value: "second-country", label: getCountryName(countries[1]) },
            { value: "international", label: "International" },
          ]
        : [{ value: "all", label: "All sources" }];

  return (
    <div className="segmented-control" aria-label="Source perspective">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
