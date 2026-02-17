const express = require("express");
const router = express.Router();
const authController = require("../controllers/AuthController");
// const authController = require("../controllers/XeroController");

router.get("/check", authController.protect, (req, res) => {
    res.status(200).json({ status: "success", authenticated: true });
});
router.get("/xero-status", authController.protect, authController.checkXeroStatus);
router.get("/register-xero", authController.protect, authController.xeroClient, authController.registerXero);
router.get("/register-xero-callback", authController.protect,authController.xeroClient, authController.registerXeroCallback);
router.post("/create-user", authController.protect, authController.createUserForTenant);
// router.get("/signup", authController.createUser);
router.post("/login", authController.login);
router.post("/logout", authController.logout);

module.exports = router;
