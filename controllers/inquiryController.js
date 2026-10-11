const pool = require("../config/db");

const allowedStatuses = ["open", "answered", "closed"];

async function createInquiry(req, res) {
  const { product_id, message } = req.body;

  if (!product_id || !message) {
    return res.status(400).json({ message: "Product and message are required." });
  }

  const [products] = await pool.query("SELECT farmer_id FROM products WHERE id = ?", [product_id]);
  const product = products[0];

  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }

  if (product.farmer_id === req.user.id) {
    return res.status(400).json({ message: "Farmers cannot inquire about their own products." });
  }

  const [result] = await pool.query(
    "INSERT INTO inquiries (buyer_id, farmer_id, product_id, message) VALUES (?, ?, ?, ?)",
    [req.user.id, product.farmer_id, product_id, message]
  );

  res.status(201).json({ message: "Inquiry sent.", id: result.insertId });
}

async function getMyInquiries(req, res) {
  const [inquiries] = await pool.query(
    `SELECT i.*, p.product_name, u.full_name AS farmer_name
     FROM inquiries i
     JOIN products p ON i.product_id = p.id
     JOIN users u ON i.farmer_id = u.id
     WHERE i.buyer_id = ?
     ORDER BY i.created_at DESC`,
    [req.user.id]
  );

  res.json({ inquiries });
}

async function getFarmerInquiries(req, res) {
  const [inquiries] = await pool.query(
    `SELECT i.*, p.product_name, u.full_name AS buyer_name, u.phone AS buyer_phone
     FROM inquiries i
     JOIN products p ON i.product_id = p.id
     JOIN users u ON i.buyer_id = u.id
     WHERE i.farmer_id = ?
     ORDER BY i.created_at DESC`,
    [req.user.id]
  );

  res.json({ inquiries });
}

async function updateInquiryStatus(req, res) {
  const { status } = req.body;

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid inquiry status." });
  }

  const [inquiries] = await pool.query("SELECT * FROM inquiries WHERE id = ?", [req.params.id]);
  const inquiry = inquiries[0];

  if (!inquiry) {
    return res.status(404).json({ message: "Inquiry not found." });
  }

  if (req.user.role !== "admin" && inquiry.farmer_id !== req.user.id) {
    return res.status(403).json({ message: "You can only update inquiries for your own products." });
  }

  await pool.query("UPDATE inquiries SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ message: "Inquiry status updated." });
}

// Feature 3 - Inquiry replies: a conversation between the buyer and the farmer of an inquiry.

async function loadInquiryForParticipant(req, res) {
  const [inquiries] = await pool.query("SELECT * FROM inquiries WHERE id = ?", [req.params.id]);
  const inquiry = inquiries[0];

  if (!inquiry) {
    res.status(404).json({ message: "Inquiry not found." });
    return null;
  }

  const isParticipant = inquiry.buyer_id === req.user.id || inquiry.farmer_id === req.user.id;

  if (!isParticipant && req.user.role !== "admin") {
    res.status(403).json({ message: "You are not part of this conversation." });
    return null;
  }

  return inquiry;
}

async function getInquiryReplies(req, res) {
  const inquiry = await loadInquiryForParticipant(req, res);
  if (!inquiry) return;

  const [replies] = await pool.query(
    `SELECT r.id, r.message, r.created_at, r.sender_id, u.full_name AS sender_name, u.role AS sender_role
     FROM inquiry_replies r
     JOIN users u ON r.sender_id = u.id
     WHERE r.inquiry_id = ?
     ORDER BY r.created_at ASC, r.id ASC`,
    [inquiry.id]
  );

  res.json({ replies, inquiry_status: inquiry.status });
}

async function addInquiryReply(req, res) {
  const inquiry = await loadInquiryForParticipant(req, res);
  if (!inquiry) return;

  // Admins can read conversations but cannot post in them.
  if (inquiry.buyer_id !== req.user.id && inquiry.farmer_id !== req.user.id) {
    return res.status(403).json({ message: "Only the buyer or the farmer can reply." });
  }

  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    return res.status(400).json({ message: "Reply message is required." });
  }

  if (message.length > 1000) {
    return res.status(400).json({ message: "Reply must be 1000 characters or fewer." });
  }

  if (inquiry.status === "closed") {
    return res.status(400).json({ message: "This inquiry is closed and cannot receive replies." });
  }

  const [result] = await pool.query(
    "INSERT INTO inquiry_replies (inquiry_id, sender_id, message) VALUES (?, ?, ?)",
    [inquiry.id, req.user.id, message]
  );

  // When the farmer answers an open inquiry it becomes "answered" automatically.
  if (req.user.id === inquiry.farmer_id && inquiry.status === "open") {
    await pool.query("UPDATE inquiries SET status = 'answered' WHERE id = ?", [inquiry.id]);
  }

  res.status(201).json({ message: "Reply sent.", id: result.insertId });
}

module.exports = {
  createInquiry,
  getMyInquiries,
  getFarmerInquiries,
  updateInquiryStatus,
  getInquiryReplies,
  addInquiryReply
};
