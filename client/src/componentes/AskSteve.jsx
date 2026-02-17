import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import styles from '../scss/AskSteve.module.scss';
import { useStreamingChat } from '../hooks/useStreamingChat';
import { SendHorizonal, MessageSquarePlus, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import MarkdownRenderer from '@/cedar/components/chatMessages/MarkdownRenderer';
import FileUploadWidget from './FileUploadWidget';
import TableWidget from './TableWidget';
import { useAgentThreads } from '@/hooks/useAgentThreads';

const API_V2_AGENT = '/api/v2/agent';

function formatThreadDate(createdAt) {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function AskSteve({ isOpen, onToggle }) {
  const [inputValue, setInputValue] = useState('');
  const [showUploadWidget, setShowUploadWidget] = useState(false);
  const [tableData, setTableData] = useState(null);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const textareaRef = useRef(null);
  const messagesContainerRef = useRef(null);

  const { messages, isStreaming, error, activeTool, threadId, sendMessage, clearThread } = useStreamingChat('/api/v1/langchain/stream');

  const {
    threads,
    currentThreadId,
    setCurrentThreadId,
    fetchThreads,
    createNewChat,
    loadThreadMessages,
    listLoading,
    loading: threadLoading,
    error: threadError,
    setError: setThreadError,
  } = useAgentThreads();

  const location = useLocation();
  const params = useParams();

  const toggleChat = () => {
    onToggle();
  }

  // When chat opens, fetch 2.0 conversations
  useEffect(() => {
    if (isOpen) {
      fetchThreads();
    }
  }, [isOpen, fetchThreads]);

  // When user selects a thread, it will be loaded via the streaming service
  const handleSelectThread = async (threadId) => {
    setConversationsOpen(false);
    if (threadId === currentThreadId) return;
    setCurrentThreadId(threadId);
    // Note: Thread messages are now managed server-side via MongoDB
    // The streaming service will use the selected threadId for context
  };

  const handleNewChat = async () => {
    setConversationsOpen(false);
    clearThread();
    setShowUploadWidget(false);
    setTableData(null);
  };

  // Detect current page context
  const getPageContext = async () => {
    const context = {
      currentPage: location.pathname,
      supplierId: null,
      logId: null
    };

    // Check if we're on a supplier page
    if (params.supplierId) {
      context.supplierId = params.supplierId;
    }

    // Check if we're on a single statement page - need to fetch supplierId from statement
    if (params.logId) {
      context.logId = params.logId;
      try {
        // Fetch statement to get supplierId
        const response = await fetch(`/api/v1/invoice/get-invoices?id=${params.logId}&page=1&limit=1`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.invoices && data.invoices.length > 0) {
            const invoice = data.invoices[0];
            if (invoice.vendorId?._id) {
              context.supplierId = invoice.vendorId._id;
            }
          }
        }
      } catch (error) {
        console.error('Error fetching statement context:', error);
      }
    }

    return context;
  }

  const handleSubmit = async (e) => {
    e?.preventDefault();

    const messageText = inputValue.trim();
    if (!messageText || isStreaming) return;

    setInputValue('');
    const context = await getPageContext();
    sendMessage(messageText, context);
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputValue]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages]);

  const isConsecutiveMessage = (index) => {
    if (index === 0) return false;
    return messages[index]?.role === messages[index - 1]?.role;
  };

  return (
    <>
      {!isOpen && (
        <button 
          className={styles.askSteveButton}
          onClick={toggleChat}
          aria-label="Ask Steve"
        >
          <span className={styles.buttonText}>Ask Steve</span>
          <span className={styles.buttonBadge}>AI</span>
        </button>
      )}
      
      {isOpen && (
        <div className={styles.chatSidebar}>
            <div className={styles.chatHeader}>
              <div className={styles.headerContent}>
                <div className={styles.headerText}>
                  <h3>Ask Steve</h3>
                  <p className={styles.headerSubtitle}>Your AI Assistant</p>
                </div>
              </div>
              <div className={styles.headerActions}>
                <div className={styles.threadController}>
                  <button
                    type="button"
                    className={styles.newChatButton}
                    onClick={handleNewChat}
                    disabled={threadLoading}
                    title="New conversation"
                    aria-label="New conversation"
                  >
                    <MessageSquarePlus size={18} />
                  </button>
                  <div className={styles.conversationsDropdown}>
                    <button
                      type="button"
                      className={styles.conversationsTrigger}
                      onClick={() => setConversationsOpen((o) => !o)}
                      aria-expanded={conversationsOpen}
                      aria-haspopup="listbox"
                    >
                      <span>{listLoading ? '…' : 'Conversations'}</span>
                      <ChevronDown size={16} className={conversationsOpen ? styles.chevronOpen : ''} />
                    </button>
                    {conversationsOpen && (
                      <>
                        <div
                          className={styles.conversationsBackdrop}
                          onClick={() => setConversationsOpen(false)}
                          aria-hidden
                        />
                        <div className={styles.conversationsList} role="listbox">
                          {threads.length === 0 && !listLoading && (
                            <div className={styles.conversationsEmpty}>No conversations yet</div>
                          )}
                          {threads.map((t) => (
                            <button
                              key={t.threadId}
                              type="button"
                              role="option"
                              aria-selected={t.threadId === currentThreadId}
                              className={styles.conversationItem + (t.threadId === currentThreadId ? ' ' + styles.conversationItemActive : '')}
                              onClick={() => handleSelectThread(t.threadId)}
                            >
                              <span className={styles.conversationId}>{t.threadId.slice(0, 8)}…</span>
                              <span className={styles.conversationDate}>{formatThreadDate(t.createdAt)}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {threadError && (
                  <div className={styles.threadError} title={threadError}>
                    {threadError.slice(0, 30)}{threadError.length > 30 ? '…' : ''}
                  </div>
                )}
                <button
                  className={styles.closeButton}
                  onClick={toggleChat}
                  aria-label="Close chat"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className={styles.chatContent}>
              <div className={styles.messagesContainer} ref={messagesContainerRef}>
                <div className={styles.messagesList}>
                  <AnimatePresence initial={false}>
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className={`${styles.messageWrapper} ${styles.assistantMessage}`}
                    >
                      <div className={styles.messageBubble}>
                        <div className={styles.assistantContent}>
                          <div className={styles.messageText}>
                            Hi, I'm here to help you. How can I help you today?
                          </div>
                        </div>
                      </div>
                    </motion.div>
                    {messages.map((message, index) => (
                      <motion.div
                        key={message.id || `msg-${index}`}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className={`${styles.messageWrapper} ${
                          message.role === 'user' ? styles.userMessage : styles.assistantMessage
                        } ${isConsecutiveMessage(index) ? styles.consecutive : ''}`}
                      >
                        <div className={styles.messageBubble}>
                          {message.role === 'assistant' || message.role === 'bot' ? (
                            <div className={styles.assistantContent}>
                              <div className={styles.messageText}>
                                <MarkdownRenderer content={message.content || ''} />
                                {message.streaming && <span className={styles.streamCursor}>|</span>}
                              </div>
                            </div>
                          ) : (
                            <div className={styles.userContent}>
                              <div className={styles.messageText}>
                                {message.content}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    {isStreaming && activeTool && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`${styles.messageWrapper} ${styles.assistantMessage}`}
                      >
                        <div className={styles.messageBubble}>
                          <div className={styles.assistantContent}>
                            <div className={styles.toolStatus}>
                              Using tool: {activeTool}...
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    {showUploadWidget && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={styles.messageWrapper}
                      >
                        <FileUploadWidget
                          onClose={() => setShowUploadWidget(false)}
                          onUploadComplete={(data) => {
                            // Add success message
                            addMessage({
                              id: `assistant-${Date.now()}-${Math.random()}`,
                              role: 'assistant',
                              type: 'text',
                              content: `Successfully uploaded ${data.files?.length || 0} file(s)!`,
                            });
                            // Widget stays open - user can close manually or upload more files
                          }}
                        />
                      </motion.div>
                    )}
                    {tableData && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={styles.messageWrapper}
                      >
                        <TableWidget
                          data={tableData.data}
                          headers={tableData.headers}
                          title={tableData.title}
                          onClose={() => setTableData(null)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className={styles.inputContainer}>
                <form onSubmit={handleSubmit} className={styles.customInputForm}>
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message..."
                    className={styles.customTextarea}
                    rows={1}
                  />
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || isStreaming}
                    className={styles.customSubmitButton}
                  >
                    <SendHorizonal className={styles.sendIcon} />
                  </button>
                </form>
              </div>
            </div>
          </div>
      )}
    </>
  );
}

export default AskSteve;
