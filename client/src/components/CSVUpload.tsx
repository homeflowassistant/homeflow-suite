/**
 * CSVUpload Component
 *
 * Design: Clean SaaS Utility — Functional Clarity
 * - Drag-and-drop zone with dashed border
 * - File type validation (CSV only)
 * - Triggers the column mapping flow on successful upload
 */

import { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { toast } from "sonner";
import { parseCSV, type ParsedCSV } from "@/lib/csv-parser";

interface CSVUploadProps {
  onFileUploaded: (data: ParsedCSV) => void;
}

export default function CSVUpload({ onFileUploaded }: CSVUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
        toast.error("Invalid file type", { description: "Please upload a CSV file only." });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File too large", { description: "Maximum file size is 10MB." });
        return;
      }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const parsed = parseCSV(text, file.name);
          onFileUploaded(parsed);
        } catch (error) {
          toast.error("Failed to parse CSV", {
            description: error instanceof Error ? error.message : "Invalid CSV format",
          });
          setSelectedFile(null);
        }
      };
      reader.onerror = () => {
        toast.error("Failed to read file");
        setSelectedFile(null);
      };
      reader.readAsText(file);
    },
    [onFileUploaded]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };
  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`csv-dropzone ${isDragging ? "csv-dropzone--dragging" : ""} ${
        selectedFile ? "csv-dropzone--filled" : ""
      }`}
    >
      {selectedFile ? (
        <div className="csv-dropzone-file">
          <FileSpreadsheet className="h-6 w-6 text-cyan-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{selectedFile.name}</p>
            <p className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearFile();
            }}
            className="ml-auto p-1 rounded-full hover:bg-slate-200 transition-colors"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      ) : (
        <div className="csv-dropzone-empty">
          <div className="csv-dropzone-icon">
            <Upload className="h-5 w-5 text-cyan-500" />
          </div>
          <p className="text-sm text-slate-700 font-semibold text-center leading-snug">
            Drag and Drop
            <br />
            or{" "}
            <span className="text-cyan-500">Upload from Computer</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">CSV files only</p>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
