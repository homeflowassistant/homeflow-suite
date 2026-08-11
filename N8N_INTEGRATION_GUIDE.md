# Integrating n8n with HomeFlow CRM

This guide describes how to use the simplified `POST /api/contacts/update-custom-field` endpoint to update CRM contacts from n8n workflows using only your Internal API Key.

## 1. Endpoint Overview

**URL:** `https://homeflow-suite.onrender.com/api/contacts/update-custom-field`
**Method:** `POST`
**Authentication:** Internal-Key Header

The endpoint automatically:
1.  **Resolves the Location:** Verifies the `locationId` exists and has the HomeFlow app installed.
2.  **Maps Field Name to ID:** Converts a human-readable `customFieldName` (e.g., `dog_name`) into the internal GHL Field ID.
3.  **Finds Contact:** Locates the contact in the CRM using an exact email match.
4.  **Updates Value:** Updates the custom field in GoHighLevel.

## 2. Request Specification

### Headers

| Header | Value | Description |
| --- | --- | --- |
| `Authorization` | `Internal-Key <YOUR_KEY>` | The value of your `INTERNAL_API_KEY` environment variable. |
| `Content-Type` | `application/json` | |

### JSON Body

```json
{
  "locationId": "XzzLQ42sqJR43o30CP34",
  "email": "moawiz.bin@thehelpdeskteam.com",
  "customFieldName": "dog_name",
  "value": "Buddy"
}
```

## 3. Step-by-Step n8n Setup

Since we have removed the signature requirement, you can now use a single **HTTP Request** node without any complex "Code" or "Crypto" nodes.

### Step 1: Add an "HTTP Request" Node
1.  **Method:** `POST`
2.  **URL:** `https://homeflow-suite.onrender.com/api/contacts/update-custom-field`
3.  **Authentication:** None (we use a custom header instead)
4.  **Send Body:** Yes
5.  **Body Content Type:** `JSON`
6.  **Specify Body:** `Using Fields Below`
7.  **Fields to Send:**
    *   `locationId`: `XzzLQ42sqJR43o30CP34`
    *   `email`: `moawiz.bin@thehelpdeskteam.com`
    *   `customFieldName`: `dog_name`
    *   `value`: `Buddy` (or reference a variable like `{{ $json.some_value }}`)
8.  **Headers (Add 1):**
    *   **Name:** `Authorization`
    *   **Value:** `Internal-Key testing11002233` (Replace with your actual key)

### Step 2: Execute and Verify
Run the node. A successful response (HTTP 200) will look like this:
```json
{
  "success": true,
  "contactId": "CONTACT_ID",
  "customFieldId": "FIELD_ID",
  "previousValue": "Old Value",
  "updatedValue": "Buddy",
  "locationId": "XzzLQ42sqJR43o30CP34",
  "email": "moawiz.bin@thehelpdeskteam.com",
  "customFieldName": "dog_name"
}
```

## 4. Troubleshooting

| Status | Code | Solution |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Check your `Authorization` header. It must be exactly `Internal-Key ` followed by your key. |
| 404 | `LOCATION_NOT_FOUND` | Ensure the `locationId` is correct and the HomeFlow app is installed in that sub-account. |
| 404 | `CONTACT_NOT_FOUND` | No contact matches the email in that specific location. |
| 404 | `CUSTOM_FIELD_NOT_FOUND` | The field name (e.g., `dog_name`) does not exist in GHL. Check Settings > Custom Fields. |
| 422 | `GHL_OPERATION_FAILED` | Check the `detail` field for the specific error from GoHighLevel. |
