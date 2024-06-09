const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = "mongodb+srv://chitkenkhoi:teptom0792.@cluster0.iqajlh9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});
// async function run() {
//     try {
//         // Connect the client to the server	(optional starting in v4.7)
//         await client.connect();
//         // Send a ping to confirm a successful connection
//         await client.db("admin").command({ ping: 1 });
//         console.log("Pinged your deployment. You successfully connected to MongoDB!");
//         return client
//     } finally {
//         // Ensures that the client will close when you finish/error
//         await client.close();
//     }
// }
// async function test() {
//     var client = await run();
//     const collection = client.db("Autheticate").collection("accounts")
//     var credential = "lequangkhoim@gmail.com"
//     collection.findOne({ credential: credential }, (err, document) => {
//         if (err) {
//             console.log(err)
//             return
//         }
//         console.log(document)
//     })
// }
// test()

async function run() {
    try {
        // Kết nối vào MongoDB
        await client.connect();
        console.log('Đã kết nối thành công đến MongoDB');

        // Thực hiện các thao tác với cơ sở dữ liệu ở đây
        // Ví dụ: Tạo một bộ sưu tập (collection) mới
        // const collection = database.collection('ten_bo_suu_tap');

        // Ví dụ: Thêm một tài liệu (document) mới vào bộ sưu tập
        // await collection.insertOne({ key: 'value' });
        return client
    } catch (error) {
        console.error('Đã xảy ra lỗi kết nối:', error);
    }
}

// Gọi hàm để kết nối vào MongoDB
module.exports = { run }