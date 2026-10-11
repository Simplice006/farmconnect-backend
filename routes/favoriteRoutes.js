const express = require("express");
const { getFavorites, addFavorite, removeFavorite } = require("../controllers/favoriteController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", authMiddleware, roleMiddleware("buyer"), asyncHandler(getFavorites));
router.post("/", authMiddleware, roleMiddleware("buyer"), asyncHandler(addFavorite));
router.delete("/:productId", authMiddleware, roleMiddleware("buyer"), asyncHandler(removeFavorite));

module.exports = router;
