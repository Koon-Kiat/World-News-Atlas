"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

interface FilterSelectProps<T extends string> {
  label: string;
  value: T;
  options: Array<FilterOption<T>>;
  onChange: (value: T) => void;
}

export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: FilterSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="filter-select" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        type="button"
        className="filter-select-trigger"
        ref={triggerRef}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        onClick={() => { setActiveIndex(selectedIndex); setOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(open ? (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : selectedIndex);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault(); setOpen(true); setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(activeIndex);
            else { setActiveIndex(selectedIndex); setOpen(true); }
          } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
          else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            const index = options.findIndex((option, index) => index > activeIndex && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
            const match = index >= 0 ? index : options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
            if (match >= 0) { event.preventDefault(); setOpen(true); setActiveIndex(match); }
          }
        }}
      >
        <span>
          <small>{label}</small>
          <strong>{selected.label}</strong>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-select-menu" role="listbox" id={listId} aria-label={label}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              id={`${listId}-${index}`}
              tabIndex={-1}
              data-active={index === activeIndex || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
