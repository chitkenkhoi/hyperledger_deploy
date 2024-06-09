const nodemailer = require("nodemailer")
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: "chitkenkhoi@gmail.com",
        pass: "ocxh vuve rlqr vvgp",
    }
})
module.exports = { transporter }