const pool = require("../config/db");

// Feature 2 - Product reviews. Only a buyer with a completed order for the product may review it.

async function hasCompletedOrder(buyerId, productId) {
  const [rows] = await pool.query(
    "SELECT id FROM orders WHERE buyer_id = ? AND product_id = ? AND status = 'completed' LIMIT 1",
    [buyerId, productId]
  );
  return rows.length > 0;
}

async function getProductReviews(req, res) {
  const [products] = await pool.query("SELECT id FROM products WHERE id = ?", [req.params.productId]);

  if (!products[0]) {
    return res.status(404).json({ message: "Product not found." });
  }

  const [reviews] = await pool.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, r.buyer_id, u.full_name AS buyer_name
     FROM product_reviews r
     JOIN users u ON r.buyer_id = u.id
     WHERE r.product_id = ?
     ORDER BY r.created_at DESC, r.id DESC`,
    [req.params.productId]
  );

  const [[summary]] = await pool.query(
    "SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 1) AS average_rating FROM product_reviews WHERE product_id = ?",
    [req.params.productId]
  );

  res.json({
    reviews,
    summary: {
      review_count: summary.review_count,
      average_rating: summary.average_rating === null ? null : Number(summary.average_rating)
    }
  });
}

async function getReviewEligibility(req, res) {
  const canReview = await hasCompletedOrder(req.user.id, req.params.productId);
  const [mine] = await pool.query(
    "SELECT id, rating, comment FROM product_reviews WHERE product_id = ? AND buyer_id = ?",
    [req.params.productId, req.user.id]
  );

  res.json({ can_review: canReview, my_review: mine[0] || null });
}

async function saveReview(req, res) {
  const productId = Number(req.params.productId);
  const rating = Number(req.body.rating);
  const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be a whole number from 1 to 5." });
  }

  if (comment.length > 500) {
    return res.status(400).json({ message: "Comment must be 500 characters or fewer." });
  }

  const [products] = await pool.query("SELECT id FROM products WHERE id = ?", [productId]);

  if (!products[0]) {
    return res.status(404).json({ message: "Product not found." });
  }

  if (!(await hasCompletedOrder(req.user.id, productId))) {
    return res.status(403).json({ message: "You can only review products from your completed orders." });
  }

  // One review per buyer and product: a second submission updates the first one.
  await pool.query(
    `INSERT INTO product_reviews (product_id, buyer_id, rating, comment) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
    [productId, req.user.id, rating, comment || null]
  );

  res.status(201).json({ message: "Review saved." });
}

async function deleteReview(req, res) {
  const [reviews] = await pool.query("SELECT * FROM product_reviews WHERE id = ?", [req.params.id]);
  const review = reviews[0];

  if (!review) {
    return res.status(404).json({ message: "Review not found." });
  }

  if (req.user.role !== "admin" && review.buyer_id !== req.user.id) {
    return res.status(403).json({ message: "You can only delete your own reviews." });
  }

  await pool.query("DELETE FROM product_reviews WHERE id = ?", [req.params.id]);
  res.json({ message: "Review deleted." });
}

module.exports = { getProductReviews, getReviewEligibility, saveReview, deleteReview };
