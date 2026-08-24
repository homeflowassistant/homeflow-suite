import React, { useState, useEffect, useRef, useMemo } from "react";
import { Tag, Search, X, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import type { PickerVariable, PickerVariablesResult } from "../../../server/ghl-service";

export interface CustomVariablePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectToken: (token: string) => void;
  data?: PickerVariablesResult;
  isLoading: boolean;
  error?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onRetry?: () => void;
}

export const CustomVariablePicker: React.FC<CustomVariablePickerProps> = ({
  isOpen,
  onClose,
  onSelectToken,
  data,
  isLoading,
  error,
  disabled = false,
  disabledReason,
  onRetry,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "custom_value" | "contact_custom_field">("all");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input on open & reset state
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
      setActiveFilter("all");
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      // Category filter
      if (activeFilter !== "all" && item.source !== activeFilter) {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const matchName = item.name.toLowerCase().includes(q);
      const matchKey = item.fieldKey.toLowerCase().includes(q);
      const matchToken = item.token.toLowerCase().includes(q);
      const matchDataType = item.dataType ? item.dataType.toLowerCase().includes(q) : false;

      return matchName || matchKey || matchToken || matchDataType;
    });
  }, [data?.items, activeFilter, searchQuery]);

  // Reset selected index when filter/query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, activeFilter]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems.length > 0 && selectedIndex < filteredItems.length) {
        onSelectToken(filteredItems[selectedIndex].token);
      }
    }
  };

  const customValuesCount = useMemo(
    () => data?.items.filter((i) => i.source === "custom_value").length || 0,
    [data?.items]
  );

  const contactFieldsCount = useMemo(
    () => data?.items.filter((i) => i.source === "contact_custom_field").length || 0,
    [data?.items]
  );

  const customValueItems = useMemo(
    () => filteredItems.filter((i) => i.source === "custom_value"),
    [filteredItems]
  );

  const contactFieldItems = useMemo(
    () => filteredItems.filter((i) => i.source === "contact_custom_field"),
    [filteredItems]
  );

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="alerts-picker-popover"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Custom values & fields picker"
    >
      {/* Popover Header */}
      <div className="alerts-picker-header">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-cyan-600" />
          <span className="alerts-picker-title">Custom values & fields</span>
        </div>
        <button
          type="button"
          className="alerts-picker-close-btn"
          onClick={onClose}
          aria-label="Close picker"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search Bar */}
      <div className="alerts-picker-search-box">
        <Search className="w-4 h-4 text-slate-400 alerts-picker-search-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="alerts-picker-search-input"
          placeholder="Search custom values and fields..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="alerts-picker-clear-search"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Category Pills */}
      <div className="alerts-picker-filter-bar">
        <button
          type="button"
          className={`alerts-picker-filter-btn ${activeFilter === "all" ? "is-active" : ""}`}
          onClick={() => setActiveFilter("all")}
        >
          All ({data?.items.length || 0})
        </button>
        <button
          type="button"
          className={`alerts-picker-filter-btn ${activeFilter === "custom_value" ? "is-active" : ""}`}
          onClick={() => setActiveFilter("custom_value")}
        >
          Custom Values ({customValuesCount})
        </button>
        <button
          type="button"
          className={`alerts-picker-filter-btn ${activeFilter === "contact_custom_field" ? "is-active" : ""}`}
          onClick={() => setActiveFilter("contact_custom_field")}
        >
          Contact Fields ({contactFieldsCount})
        </button>
      </div>

      {/* Partial Failure Notice */}
      {data?.sourceStatus && (data.sourceStatus.customValues === "error" || data.sourceStatus.contactCustomFields === "error") && (
        <div className="alerts-picker-partial-warning">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            {data.sourceStatus.customValues === "error"
              ? "Custom values could not be loaded."
              : "Contact custom fields could not be loaded."}
          </span>
        </div>
      )}

      {/* Content Area */}
      <div className="alerts-picker-body custom-scrollbar">
        {isLoading ? (
          <div className="alerts-picker-loading">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-600 mb-2" />
            <span>Loading custom values and fields...</span>
          </div>
        ) : error ? (
          <div className="alerts-picker-error">
            <AlertCircle className="w-6 h-6 text-red-500 mb-2" />
            <p className="alerts-picker-error-msg">{error}</p>
            {onRetry && (
              <button type="button" className="alerts-picker-retry-btn" onClick={onRetry}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
              </button>
            )}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="alerts-picker-empty">
            <p>No matching custom values or contact fields.</p>
          </div>
        ) : (
          <>
            {/* Custom Values Section */}
            {customValueItems.length > 0 && (
              <div className="alerts-picker-section">
                <div className="alerts-picker-section-label">Custom Values</div>
                {customValueItems.map((item) => {
                  const globalIdx = filteredItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      className={`alerts-picker-row ${isSelected ? "is-selected" : ""}`}
                      onClick={() => onSelectToken(item.token)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <div className="alerts-picker-row-header">
                        <span className="alerts-picker-item-name">{item.name}</span>
                        <span className="alerts-picker-badge cv-badge">Custom Value</span>
                      </div>
                      <code className="alerts-picker-item-token">{item.token}</code>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Contact Custom Fields Section */}
            {contactFieldItems.length > 0 && (
              <div className="alerts-picker-section">
                <div className="alerts-picker-section-label">Contact Custom Fields</div>
                {contactFieldItems.map((item) => {
                  const globalIdx = filteredItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      className={`alerts-picker-row ${isSelected ? "is-selected" : ""}`}
                      onClick={() => onSelectToken(item.token)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <div className="alerts-picker-row-header">
                        <span className="alerts-picker-item-name">{item.name}</span>
                        <div className="flex items-center gap-1">
                          {item.dataType && (
                            <span className="alerts-picker-type-badge">{item.dataType}</span>
                          )}
                          <span className="alerts-picker-badge cf-badge">Contact Field</span>
                        </div>
                      </div>
                      <code className="alerts-picker-item-token">{item.token}</code>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
