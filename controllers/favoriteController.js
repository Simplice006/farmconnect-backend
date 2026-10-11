const pool = require("../config/db");

// Feature 1 - Favorites stored in the database (the buyer keeps them on any browser/device).

async function getFavorites(req, res) {
  const [favorites] = await pool.query(
    `SELECT f.id, f.created_at AS saved_at, p.id AS product_id, p.product_name, p.price_per_unit,
            p.unit, p.district, p.image, p.availability_status, c.name AS category_name
     FROM favorites f
     JOIN products p ON f.product_id = p.id
     LEFT JOIN product_categories c ON p.category_id = c.id
     WHERE f.buyer_id = ?
     ORDER BY f.created_at DESC, f.id DESC`,
    [req.user.id]
  );

  res.json({ favorites });
}

async function addFavorite(req, res) {
  const productId = Number(req.body.product_id);

  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ message: "A valid product_id is required." });
  }

  const [products] = await pool.query("SELECT id FROM products WHERE id = ?", [productId]);

  if (!products[0]) {
    return res.status(404).json({ message: "Product not found." });
  }

  // The UNIQUE (buyer_id, product_id) key makes INSERT IGNORE safe to repeat.
  const [result] = await pool.query(
    "INSERT IGNORE INTO favorites (buyer_id, product_id) VALUES (?, ?)",
    [req.user.id, productId]
  );

  if (result.affectedRows === 0) {
    return res.status(200).json({ message: "Product is already in your favorites." });
  }

  res.status(201).json({ message: "Product saved to favorites." });
}

async function removeFavorite(req, res) {
  // The buyer_id comes from the JWT, so a buyer can only delete their own favorites.
  const [result] = await pool.query(
    "DELETE FROM favorites WHERE buyer_id = ? AND product_id = ?",
    [req.user.id, req.params.productId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "This product is not in your favorites." });
  }

  res.json({ message: "Product removed from favorites." });
}

module.exports = { getFavorites, addFavorite, removeFavorite };
