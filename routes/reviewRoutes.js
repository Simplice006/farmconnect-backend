const express = require("express");
const {
  getProductReviews,
  getReviewEligibility,
  saveReview,
  deleteReview
} = require("../controllers/reviewController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/product/:productId", asyncHandler(getProductReviews));
router.get("/product/:productId/eligibility", authMiddleware, roleMiddleware("buyer"), asyncHandler(getReviewEligibility));
router.post("/product/:productId", authMiddleware, roleMiddleware("buyer"), asyncHandler(saveReview));
router.delete("/:id", authMiddleware, roleMiddleware("buyer", "admin"), asyncHandler(deleteReview));

module.exports = router;
