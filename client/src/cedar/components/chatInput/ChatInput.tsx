import { cn, useCedarStore, HumanInTheLoopMessage } from 'cedar-os';

import { CedarEditorContent as EditorContent } from 'cedar-os';
import { SendHorizonal } from 'lucide-react';
import { motion } from 'motion/react';
import React, { useEffect } from 'react';

import './ChatInput.css';
import { useCedarEditor } from 'cedar-os';
import { HumanInTheLoopIndicator } from '@/cedar/components/chatInput/HumanInTheLoopIndicator';

// ChatContainer component with position options
export type ChatContainerPosition = 'bottom-center' | 'embedded' | 'custom';

// Inlined mention items removed; using external suggestion module

export const ChatInput: React.FC<{
	handleFocus?: () => void;
	handleBlur?: () => void;
	isInputFocused?: boolean;
	className?: string; // Additional classes for the container
	stream?: boolean; // Whether to use streaming for responses
}> = ({
	handleFocus,
	handleBlur,
	isInputFocused,
	className = '',
	stream = true,
}) => {
	const [isFocused, setIsFocused] = React.useState(false);

	const { editor, isEditorEmpty, handleSubmit } = useCedarEditor({
		onFocus: () => {
			setIsFocused(true);
			handleFocus?.();
		},
		onBlur: () => {
			setIsFocused(false);
			handleBlur?.();
		},
		stream,
	});

	// Get latest message to check for human-in-the-loop state
	const messages = useCedarStore((state) => state.messages);
	const latestMessage = messages[messages.length - 1];
	const isHumanInTheLoopSuspended =
		latestMessage?.type === 'humanInTheLoop' &&
		(latestMessage as HumanInTheLoopMessage).state === 'suspended';

	// Focus the editor when isInputFocused changes to allow for controlled focusing
	useEffect(() => {
		if (isInputFocused && editor) {
			editor.commands.focus();
		}
	}, [isInputFocused, editor]);

	// Handle tab key to focus the editor and escape to unfocus
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Tab') {
				e.preventDefault();
				if (editor) {
					editor.commands.focus();
					setIsFocused(true);
				}
			} else if (e.key === 'Escape') {
				if (isFocused && editor) {
					editor.commands.blur();
					setIsFocused(false);
				}
			}
		};

		// Add the event listener
		window.addEventListener('keydown', handleKeyDown);

		// Clean up
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [editor, isFocused]);

	return (
		<div
			className={cn(
				'bg-white dark:bg-gray-800 rounded-2xl p-4 text-sm shadow-lg',
				className
			)}>
			{/* Chat editor row */}
			<div className='relative w-full h-fit' id='cedar-chat-input'>
				{isHumanInTheLoopSuspended ? (
					<div className='py-2 items-center justify-center w-full'>
						<HumanInTheLoopIndicator
							state={(latestMessage as HumanInTheLoopMessage).state}
						/>
					</div>
				) : (
					<div className='flex items-center gap-2'>
						<motion.div
							layoutId='chatInput'
							className='flex-1 justify-center py-2 min-h-[2.5rem]'
							aria-label='Message input'>
							<EditorContent
								editor={editor}
								className='prose prose-sm max-w-none focus:outline-none outline-none focus:ring-0 ring-0 [&_*]:focus:outline-none [&_*]:outline-none [&_*]:focus:ring-0 [&_*]:ring-0 placeholder-gray-400 dark:placeholder-gray-500 [&_.ProseMirror]:p-0 [&_.ProseMirror]:outline-none [&_.ProseMirror]:break-words [&_.ProseMirror]:overflow-wrap-anywhere [&_.ProseMirror]:word-break-break-word [&_.ProseMirror]:text-gray-900 dark:[&_.ProseMirror]:text-gray-100'
							/>
						</motion.div>
					</div>
				)}
			</div>

			{/* Bottom row. Contains send chat button */}
			<div
				id='input-tools'
				className='flex items-center justify-end mt-3'>
				<button
					type='button'
					onClick={() => handleSubmit()}
					disabled={isEditorEmpty}
					className={cn(
						'flex items-center justify-center rounded-full p-3 transition-all duration-200 shadow-md',
						isEditorEmpty
							? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-50'
							: 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95'
					)}>
					<motion.div
						animate={{ rotate: isEditorEmpty ? 0 : -90 }}
						transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
						<SendHorizonal className='w-5 h-5' />
					</motion.div>
				</button>
			</div>
		</div>
	);
};
