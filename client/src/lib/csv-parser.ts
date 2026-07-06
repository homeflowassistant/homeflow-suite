/**
 * CSV Parser Utility
 * 
 * Handles parsing CSV files, detecting columns, and mapping them
 * to the required contact fields.
 */

export interface ParsedCSV {
  headers: string[];
  rows: string[][];
  fileName: string;
  totalRows: number;
}

export interface ColumnMapping {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  postalCode?: string;
  numberOfDogs?: string;
  lastTimeScooped?: string;
  frequency?: string;
}

export interface MappedContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postalCode: string;
  numberOfDogs: string;
  lastTimeScooped: string;
  frequency: string;
}

/**
 * Parse a CSV file and return structured data
 */
export function parseCSV(text: string, fileName: string): ParsedCSV {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  
  if (lines.length < 2) {
    throw new Error('CSV file must contain at least a header row and one data row');
  }

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCSVLine(line));

  // Filter out rows that are completely empty
  const validRows = rows.filter((row) => row.some((cell) => cell.trim() !== ''));

  return {
    headers,
    rows: validRows,
    fileName,
    totalRows: validRows.length,
  };
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Auto-detect column mappings based on header names
 */
export function autoDetectMappings(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  // Detect first name
  const firstNameIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'first name' ||
      h === 'firstname' ||
      h === 'first_name' ||
      h === 'fname'
  );
  if (firstNameIdx >= 0) mapping.firstName = headers[firstNameIdx];

  // Detect last name
  const lastNameIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'last name' ||
      h === 'lastname' ||
      h === 'last_name' ||
      h === 'lname'
  );
  if (lastNameIdx >= 0) mapping.lastName = headers[lastNameIdx];

  // Detect full name
  const fullNameIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'full name' ||
      h === 'fullname' ||
      h === 'full_name' ||
      h === 'name' ||
      h === 'contact name'
  );
  if (fullNameIdx >= 0) mapping.fullName = headers[fullNameIdx];

  // Detect email
  const emailIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'email' ||
      h === 'email address' ||
      h === 'emailaddress' ||
      h === 'e-mail'
  );
  if (emailIdx >= 0) mapping.email = headers[emailIdx];

  // Detect phone
  const phoneIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'phone' ||
      h === 'phone number' ||
      h === 'phonenumber' ||
      h === 'phone_number' ||
      h === 'mobile' ||
      h === 'cell' ||
      h === 'telephone'
  );
  if (phoneIdx >= 0) mapping.phone = headers[phoneIdx];

  // Detect street address
  const addressIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'street address' ||
      h === 'address' ||
      h === 'address 1' ||
      h === 'address1' ||
      h === 'service address'
  );
  if (addressIdx >= 0) mapping.address1 = headers[addressIdx];

  // Detect city
  const cityIdx = lowerHeaders.findIndex((h) => h === 'city');
  if (cityIdx >= 0) mapping.city = headers[cityIdx];

  // Detect zip/postal code
  const postalCodeIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'zip' ||
      h === 'zip code' ||
      h === 'zipcode' ||
      h === 'postal code' ||
      h === 'postalcode'
  );
  if (postalCodeIdx >= 0) mapping.postalCode = headers[postalCodeIdx];

  // Detect custom review fields
  const numberOfDogsIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'number of dogs' ||
      h === '# of dogs' ||
      h === 'dogs' ||
      h === 'number_of_dogs'
  );
  if (numberOfDogsIdx >= 0) mapping.numberOfDogs = headers[numberOfDogsIdx];

  const lastTimeScoopedIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'last time scooped' ||
      h === 'last_time_scooped' ||
      h === 'last scooped'
  );
  if (lastTimeScoopedIdx >= 0) mapping.lastTimeScooped = headers[lastTimeScoopedIdx];

  const frequencyIdx = lowerHeaders.findIndex(
    (h) => h === 'frequency' || h === 'service frequency' || h === 'cleaning frequency'
  );
  if (frequencyIdx >= 0) mapping.frequency = headers[frequencyIdx];

  return mapping;
}

/**
 * Apply column mappings to parsed CSV rows to produce contact objects
 */
export function applyMappings(
  parsedCSV: ParsedCSV,
  mapping: ColumnMapping
): MappedContact[] {
  const { headers, rows } = parsedCSV;

  return rows.map((row) => {
    const getVal = (header?: string) => {
      if (!header) return '';
      const idx = headers.indexOf(header);
      return idx >= 0 ? (row[idx] || '').trim() : '';
    };

    let firstName = getVal(mapping.firstName);
    let lastName = getVal(mapping.lastName);

    // If full name is mapped but first/last aren't, split the full name
    if (mapping.fullName && (!firstName || !lastName)) {
      const fullName = getVal(mapping.fullName);
      const parts = fullName.split(/\s+/);
      if (!firstName) firstName = parts[0] || '';
      if (!lastName) lastName = parts.slice(1).join(' ') || '';
    }

    return {
      firstName,
      lastName,
      email: getVal(mapping.email),
      phone: getVal(mapping.phone),
      address1: getVal(mapping.address1),
      city: getVal(mapping.city),
      postalCode: getVal(mapping.postalCode),
      numberOfDogs: getVal(mapping.numberOfDogs),
      lastTimeScooped: getVal(mapping.lastTimeScooped),
      frequency: getVal(mapping.frequency),
    };
  });
}

/**
 * Validate that required mappings are present
 */
export function validateMappings(mapping: ColumnMapping): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // At least one name field required
  if (!mapping.firstName) {
    errors.push('First Name must be mapped');
  }

  // At least one contact method required
  if (!mapping.email && !mapping.phone) {
    errors.push('At least Email or Phone Number must be mapped');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
