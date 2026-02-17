import React from 'react';
import styles from '../scss/StyledChatBubbles.module.scss';
import { useCedarStore, useThreadMessages } from 'cedar-os';
import { AnimatePresence, motion } from 'motion/react';
import MarkdownRenderer from '../cedar/components/chatMessages/MarkdownRenderer';

const StyledChatBubbles = () => {
  const { messages } = useThreadMessages();
  const isProcessing = useCedarStore((state) => state.isProcessing);

  const isConsecutiveMessage = (index) => {
    if (index === 0) return false;
    return messages[index].role === messages[index - 1].role;
  };

  return (
    <div className={styles.chatContainer}>
      <AnimatePresence initial={false}>
        {messages.map((message, index) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{
              duration: 0.2,
              ease: "easeOut"
            }}
            className={`${styles.messageWrapper} ${
              message.role === 'user' ? styles.userMessage : styles.botMessage
            } ${isConsecutiveMessage(index) ? styles.consecutive : ''}`}
          >
            <div className={styles.messageBubble}>
              {message.role === 'bot' || message.role === 'assistant' ? (
                <div className={styles.botContent}>
                  <div className={styles.avatar}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="#3b82f6"/>
                      <path d="M12 8C14.21 8 16 9.79 16 12V16C16 17.1 15.1 18 14 18H10C8.9 18 8 17.1 8 16V12C8 9.79 9.79 8 12 8Z" fill="#3b82f6"/>
                      <path d="M12 20C13.1 20 14 20.9 14 22C14 23.1 13.1 24 12 24C10.9 24 10 23.1 10 22C10 20.9 10.9 20 12 20Z" fill="#3b82f6"/>
                    </svg>
                  </div>
                  <div className={styles.messageText}>
                    <MarkdownRenderer content={message.content} />
                  </div>
                </div>
              ) : (
                <div className={styles.userContent}>
                  <div className={styles.messageText}>
                    <MarkdownRenderer content={message.content} />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
        
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${styles.messageWrapper} ${styles.botMessage}`}
          >
            <div className={styles.messageBubble}>
              <div className={styles.botContent}>
                <div className={styles.avatar}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="#3b82f6"/>
                    <path d="M12 8C14.21 8 16 9.79 16 12V16C16 17.1 15.1 18 14 18H10C8.9 18 8 17.1 8 16V12C8 9.79 9.79 8 12 8Z" fill="#3b82f6"/>
                    <path d="M12 20C13.1 20 14 20.9 14 22C14 23.1 13.1 24 12 24C10.9 24 10 23.1 10 22C10 20.9 10.9 20 12 20Z" fill="#3b82f6"/>
                  </svg>
                </div>
                <div className={styles.typingIndicator}>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StyledChatBubbles;
