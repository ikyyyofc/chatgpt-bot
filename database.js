const mongoose = require("mongoose");

mongoose.set("strictQuery", false);

const chatSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true
        },
        conversations: [
            {
                role: {
                    type: String,
                    required: true,
                    enum: ["user", "assistant"]
                },
                content: {
                    type: String,
                    required: true
                },
                timestamp: {
                    type: Date,
                    default: Date.now
                }
            }
        ],
        lastUpdate: {
            type: Date,
            default: Date.now,
            index: true
        }
    },
    {
        timestamps: true
    }
);

chatSchema.pre("save", function (next) {
    if (this.conversations.length > 16) {
        const recentMessages = this.conversations.slice(-15);
        this.conversations = [...recentMessages];
    }
    next();
});

const Chat = mongoose.model("Chat", chatSchema);

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.mongodb, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);

        await Chat.collection.createIndex({ userId: 1 });
        await Chat.collection.createIndex({ lastUpdate: 1 });
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        process.exit(1);
    }
};

mongoose.connection.on("disconnected", () => {
    console.log("MongoDB disconnected! Attempting to reconnect...");
    setTimeout(connectDB, 5000);
});

mongoose.connection.on("error", err => {
    console.error("MongoDB connection error:", err);
});

/*async function updateAllChatsSystemMessages() {
    try {
        const chats = await Chat.find({});

        for (const chat of chats) {
            chat.conversations = chat.conversations.filter(
                msg => msg.role !== "system"
            );

            chat.conversations.unshift(...defaultSystemMessages);

            await chat.save();
        }

        console.log("Successfully updated all chats with new system messages");
    } catch (error) {
        console.error("Error updating system messages:", error);
    }
}*/

async function getOrCreateChat(userId) {
    try {
        let chat = await Chat.findOne({ userId });

        if (!chat) {
            chat = new Chat({
                userId,
                conversations: []
            });
            await chat.save();
        } else {
            chat.conversations = [...chat.conversations];
            await chat.save();
        }

        return chat;
    } catch (error) {
        console.error("Error in getOrCreateChat:", error);
        throw error;
    }
}

async function updateChat(chat, newMessage) {
    try {
        chat.conversations.push(newMessage);
        chat.lastUpdate = new Date();
        await chat.save();
        return chat;
    } catch (error) {
        console.error("Error in updateChat:", error);
        throw error;
    }
}

setInterval(
    async () => {
        try {
            const thirtyDaysAgo = new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000
            );
            const result = await Chat.deleteMany({
                lastUpdate: { $lt: thirtyDaysAgo }
            });
            console.log(`Cleaned ${result.deletedCount} old chat records`);
        } catch (error) {
            console.error("Error in cleanup routine:", error);
        }
    },
    24 * 60 * 60 * 1000
);

module.exports = {
    connectDB,
    Chat,
    getOrCreateChat,
    updateChat
    // updateAllChatsSystemMessages
};
