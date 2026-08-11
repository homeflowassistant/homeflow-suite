/**
 * ColumnMapping Component
 * 
 * Design: Clean SaaS Utility — Functional Clarity
 * - Preview table showing first 7 rows
 * - Column mapping interface with dropdowns
 * - Green checkmarks for confirmed mappings
 * - Validation before proceeding
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { type ParsedCSV, type ColumnMapping as ColumnMappingType, autoDetectMappings, validateMappings } from '@/lib/csv-parser';

interface ColumnMappingProps {
  parsedCSV: ParsedCSV;
  onBack: () => void;
  onNext: (mapping: ColumnMappingType) => void;
}

type MappingField =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'address1'
  | 'city'
  | 'postalCode'
  | 'numberOfDogs'
  | 'lastTimeScooped'
  | 'frequency';

const FIELD_OPTIONS: { key: MappingField; label: string; required: boolean; helper?: string }[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'phone', label: 'Phone Number', required: true },
  { key: 'numberOfDogs', label: 'Number of Dogs', required: false, helper: 'GHL custom field: number_of_dogs' },
  { key: 'lastName', label: 'Last Name', required: false },
  { key: 'email', label: 'Email', required: true },
  { key: 'lastTimeScooped', label: 'Last Time Scooped', required: false, helper: 'GHL custom field: last_time_yard_was_thoroughly_cleaned' },
  { key: 'frequency', label: 'Frequency', required: false, helper: 'GHL custom field: clean_up_frequency' },
  { key: 'address1', label: 'Street Address', required: false, helper: 'GHL standard field: address1' },
  { key: 'city', label: 'City', required: false, helper: 'GHL standard field: city' },
  { key: 'postalCode', label: 'Zip Code', required: false, helper: 'GHL standard field: postalCode' },
];

export default function ColumnMapping({ parsedCSV, onBack, onNext }: ColumnMappingProps) {
  const [mapping, setMapping] = useState<ColumnMappingType>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Auto-detect mappings on mount
  useEffect(() => {
    const detected = autoDetectMappings(parsedCSV.headers);
    setMapping(detected);
  }, [parsedCSV.headers]);

  const handleMappingChange = (field: MappingField, value: string) => {
    setMapping((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
    setValidationErrors([]);
  };

  const handleRemoveMapping = (field: MappingField) => {
    setMapping((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleNext = () => {
    const { valid, errors } = validateMappings(mapping);
    if (!valid) {
      setValidationErrors(errors);
      return;
    }
    onNext(mapping);
  };

  const previewRows = parsedCSV.rows.slice(0, 7);

  const hasNameMapping = Boolean(mapping.firstName);
  const hasContactMapping = mapping.email || mapping.phone;

  return (
    <div className="space-y-6">
      {/* Preview Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            Preview (first {previewRows.length} rows)
          </h3>
          <span className="text-xs text-muted-foreground">
            Scroll horizontally to see all columns
          </span>
        </div>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                {parsedCSV.headers.map((header, idx) => (
                  <th key={idx} className="px-3 py-2 text-left font-medium text-foreground whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground">{rowIdx + 1}</td>
                  {parsedCSV.headers.map((_, colIdx) => (
                    <td key={colIdx} className="px-3 py-2 text-foreground whitespace-nowrap">
                      {row[colIdx] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Column Mapping */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">Map Your Columns</h3>
          <span className="text-xs text-muted-foreground">At least one field per group required</span>
        </div>

        <div className={`border-l-4 ${(hasNameMapping && hasContactMapping) ? 'border-l-primary' : 'border-l-border'} pl-4 mb-5 py-3`}>
          <div className="flex items-center gap-2 mb-3">
            {hasNameMapping && hasContactMapping && <Check className="h-4 w-4 text-primary" />}
            <h4 className="text-sm font-medium text-foreground">Map the CSV fields below</h4>
          </div>
          <div className="space-y-3">
            {FIELD_OPTIONS.map((field) => (
              <MappingRow
                key={field.key}
                label={field.label}
                helper={field.helper}
                value={mapping[field.key]}
                options={parsedCSV.headers}
                onChange={(val) => handleMappingChange(field.key, val)}
                onRemove={() => handleRemoveMapping(field.key)}
              />
            ))}
          </div>
        </div>

        <div className="pl-4 py-2">
          <p className="text-xs text-muted-foreground">
            Required for upload: First Name, and Email or Phone Number.
          </p>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {validationErrors.map((error, idx) => (
            <p key={idx} className="text-sm text-destructive">{error}</p>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={handleNext} className="gap-1">
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Sub-component for individual mapping rows
function MappingRow({
  label,
  helper,
  value,
  options,
  onChange,
  onRemove,
}: {
  label: string;
  helper?: string;
  value?: string;
  options: string[];
  onChange: (val: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0">
        <span className="text-sm text-foreground block">{label}</span>
        {helper && <span className="text-[11px] text-muted-foreground block mt-0.5">{helper}</span>}
      </div>
      <span className="text-muted-foreground">→</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
      >
        <option value="">Select column</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {value && (
        <>
          <Check className="h-4 w-4 text-primary shrink-0" />
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-muted transition-colors shrink-0"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </>
      )}
    </div>
  );
}
