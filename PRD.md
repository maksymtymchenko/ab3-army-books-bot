# Task: Node.js Telegram Bot for Book Management

**Role:** You are a Senior Node.js Developer. Your goal is to build a Telegram Bot that acts as a management interface for a book library and reservation system.

**Context:** The backend API is already functional. You must implement the bot logic to consume the endpoints defined in the provided `BOOK_ORDER.md` file.

---

### 1. Functional Requirements

The bot must support two primary roles (Admin/User) or focus on these administrative actions:

- **Inventory Management:**
  - `Add Book`: Trigger a flow to input book details and POST to the API.
  - `Delete Book`: Remove a book by ID or via a list selection.
  - `Update Status`: Toggle book availability (e.g., Available ↔ Reserved).
- **Order/Reservation Management:**
  - `View Orders`: Fetch and display all active book reservations.
  - `Order Actions`: Use **Inline Keyboards** (buttons) under each order message to "Accept" or "Decline" the request.

### 2. Technical Stack & Architecture

- **Framework:** `telegraf` (Node.js).
- **HTTP Client:** `axios`.
- **Structure:**
  - `bot.js`: Main entry point and command handling.
  - `api.js`: A dedicated service layer for all Axios calls to the backend.
  - `.env`: Management of `BOT_TOKEN` and `BASE_API_URL`.
- **UX/UI:** Use `Markup.inlineKeyboard` for status changes and order approvals to minimize typing.

### 3. Implementation Guidelines

- **Validation:** Ensure that the bot validates user input before sending it to the API.
- **Error Handling:** Wrap API calls in `try/catch`. If the backend returns a `400` or `500`, the bot should inform the user gracefully (e.g., "Failed to update book status").
- **State Management:** For multi-step processes like adding a book, use a Wizard Scene or a simple session-based state.

---

### 4. Input Data

Refer to the following `BOOK_ORDER.md` documentation for all endpoint paths, request bodies, and headers:

[PASTE YOUR BOOK_ORDER.MD CONTENT HERE]
